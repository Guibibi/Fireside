use mediasoup::prelude::{
    Consumer, ConsumerId, ConsumerOptions, DtlsParameters, IceCandidate, IceParameters, MediaKind,
    MimeTypeVideo, PlainTransport, PlainTransportOptions, Producer, ProducerId, ProducerOptions,
    RtcpParameters, RtpCapabilities, RtpCapabilitiesFinalized, RtpCodecParameters,
    RtpCodecParametersParameters, RtpEncodingParameters, RtpParameters, Transport, WebRtcTransport,
    WebRtcTransportListenInfos, WebRtcTransportOptions, WebRtcTransportRemoteParameters,
};
use serde::Serialize;
use std::collections::HashMap;
use uuid::Uuid;

use super::MediaService;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportDirection {
    Send,
    Recv,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProducerSource {
    Microphone,
    Camera,
    Screen,
}

impl ProducerSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Microphone => "microphone",
            Self::Camera => "camera",
            Self::Screen => "screen",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RoutingMode {
    Sfu,
}

impl RoutingMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sfu => "sfu",
        }
    }
}

#[derive(Debug)]
pub(crate) struct ProducerEntry {
    pub producer: Producer,
    pub source: ProducerSource,
    pub routing_mode: RoutingMode,
}

impl TransportDirection {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Send => "send",
            Self::Recv => "recv",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CreatedWebRtcTransport {
    pub id: String,
    pub ice_parameters: IceParameters,
    pub ice_candidates: Vec<IceCandidate>,
    pub dtls_parameters: DtlsParameters,
}

#[derive(Debug)]
pub(crate) struct ConnectionMediaState {
    pub channel_id: Uuid,
    pub send_transport_id: Option<String>,
    pub recv_transport_id: Option<String>,
    pub transports: HashMap<String, WebRtcTransport>,
    pub native_transports_by_producer: HashMap<String, PlainTransport>,
    pub producers: HashMap<String, ProducerEntry>,
    pub consumers: HashMap<String, Consumer>,
}

impl ConnectionMediaState {
    fn new(channel_id: Uuid) -> Self {
        Self {
            channel_id,
            send_transport_id: None,
            recv_transport_id: None,
            transports: HashMap::new(),
            native_transports_by_producer: HashMap::new(),
            producers: HashMap::new(),
            consumers: HashMap::new(),
        }
    }
}

const NATIVE_H264_CLOCK_RATE: u32 = 90_000;
const NATIVE_H264_PT: u8 = 96;
const NATIVE_H264_PACKETIZATION_MODE: u8 = 1;
const NATIVE_H264_PROFILE_LEVEL_ID: &str = "42e01f";

#[derive(Debug, Clone, Serialize)]
pub struct NativeSenderSession {
    pub producer_id: String,
    pub kind: String,
    pub source: String,
    pub routing_mode: String,
    pub rtp_target: String,
    pub payload_type: u8,
    pub ssrc: u32,
    pub mime_type: String,
    pub clock_rate: u32,
    pub packetization_mode: u8,
    pub profile_level_id: String,
    pub owner_connection_id: Uuid,
}

fn canonical_native_ssrc(connection_id: Uuid) -> u32 {
    let bytes = connection_id.as_bytes();
    let mut seed = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    if seed == 0 {
        seed = 0x4E41_5456;
    }
    seed
}

fn native_h264_parameters(ssrc: u32) -> RtpParameters {
    let mut parameters = RtpCodecParametersParameters::default();
    parameters
        .insert("level-asymmetry-allowed", 1_u32)
        .insert("packetization-mode", NATIVE_H264_PACKETIZATION_MODE as u32)
        .insert("profile-level-id", NATIVE_H264_PROFILE_LEVEL_ID);

    RtpParameters {
        mid: Some("native-screen".to_string()),
        codecs: vec![RtpCodecParameters::Video {
            mime_type: MimeTypeVideo::H264,
            payload_type: NATIVE_H264_PT,
            clock_rate: NATIVE_H264_CLOCK_RATE.try_into().unwrap(),
            parameters,
            rtcp_feedback: vec![],
        }],
        header_extensions: vec![],
        encodings: vec![RtpEncodingParameters {
            ssrc: Some(ssrc),
            rid: None,
            codec_payload_type: Some(NATIVE_H264_PT),
            rtx: None,
            dtx: None,
            scalability_mode: Default::default(),
            max_bitrate: None,
        }],
        rtcp: RtcpParameters {
            cname: Some(format!("native-{ssrc:x}")),
            reduced_size: true,
        },
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PublishedProducer {
    pub producer_id: String,
    pub kind: String,
    pub source: String,
    pub routing_mode: String,
    pub owner_connection_id: Uuid,
}

#[derive(Debug, Clone, Serialize)]
pub struct CreatedConsumer {
    pub id: String,
    pub producer_id: String,
    pub kind: String,
    pub rtp_parameters: RtpParameters,
}

#[derive(Debug, Clone)]
pub struct ClosedProducer {
    pub channel_id: Uuid,
    pub producer_id: String,
    pub source: String,
    pub routing_mode: String,
}

fn media_kind_as_str(kind: MediaKind) -> &'static str {
    match kind {
        MediaKind::Audio => "audio",
        MediaKind::Video => "video",
    }
}

impl MediaService {
    pub async fn router_rtp_capabilities(
        &self,
        channel_id: Uuid,
    ) -> Result<RtpCapabilitiesFinalized, String> {
        let router = self.get_or_create_router(channel_id).await;
        Ok(router.rtp_capabilities())
    }

    pub async fn create_webrtc_transport_for_connection(
        &self,
        connection_id: Uuid,
        channel_id: Uuid,
        direction: TransportDirection,
    ) -> Result<CreatedWebRtcTransport, String> {
        {
            let media_state_lock = self.connection_media();
            let mut media_state = media_state_lock.lock().await;
            if let Some(existing) = media_state.get(&connection_id) {
                if existing.channel_id != channel_id {
                    media_state.remove(&connection_id);
                }
            }
        }

        let router = self.get_or_create_router(channel_id).await;
        let listen_infos = WebRtcTransportListenInfos::new(self.webrtc_listen_info());
        let transport_options = WebRtcTransportOptions::new(listen_infos);

        let transport = router
            .create_webrtc_transport(transport_options)
            .await
            .map_err(|error| format!("Failed to create WebRTC transport: {error}"))?;

        let transport_id = transport.id().to_string();
        let created_transport = CreatedWebRtcTransport {
            id: transport_id.clone(),
            ice_parameters: transport.ice_parameters().clone(),
            ice_candidates: transport.ice_candidates().clone(),
            dtls_parameters: transport.dtls_parameters(),
        };

        {
            let media_state_lock = self.connection_media();
            let mut media_state = media_state_lock.lock().await;
            let entry = media_state
                .entry(connection_id)
                .or_insert_with(|| ConnectionMediaState::new(channel_id));

            if entry.channel_id != channel_id {
                *entry = ConnectionMediaState::new(channel_id);
            }

            let replaced_id = match direction {
                TransportDirection::Send => entry.send_transport_id.replace(transport_id.clone()),
                TransportDirection::Recv => entry.recv_transport_id.replace(transport_id.clone()),
            };

            if let Some(previous_transport_id) = replaced_id {
                entry.transports.remove(&previous_transport_id);
            }

            entry.transports.insert(transport_id, transport);
        }

        Ok(created_transport)
    }

    pub async fn connect_webrtc_transport_for_connection(
        &self,
        connection_id: Uuid,
        channel_id: Uuid,
        transport_id: &str,
        dtls_parameters: DtlsParameters,
    ) -> Result<(), String> {
        let transport = {
            let media_state_lock = self.connection_media();
            let media_state = media_state_lock.lock().await;
            let Some(entry) = media_state.get(&connection_id) else {
                return Err("No media session exists for this connection".into());
            };

            if entry.channel_id != channel_id {
                return Err("Transport does not belong to this voice channel".into());
            }

            let Some(transport) = entry.transports.get(transport_id) else {
                return Err("Transport not found".into());
            };

            transport.clone()
        };

        transport
            .connect(WebRtcTransportRemoteParameters { dtls_parameters })
            .await
            .map_err(|error| format!("Failed to connect WebRTC transport: {error}"))
    }

    pub async fn create_producer_for_connection(
        &self,
        connection_id: Uuid,
        channel_id: Uuid,
        kind: MediaKind,
        source: ProducerSource,
        routing_mode: RoutingMode,
        rtp_parameters: RtpParameters,
    ) -> Result<PublishedProducer, String> {
        let send_transport = {
            let media_state_lock = self.connection_media();
            let media_state = media_state_lock.lock().await;
            let Some(entry) = media_state.get(&connection_id) else {
                return Err("No media session exists for this connection".into());
            };

            if entry.channel_id != channel_id {
                return Err("Transport does not belong to this voice channel".into());
            }

            let Some(send_transport_id) = entry.send_transport_id.as_ref() else {
                return Err("Send transport has not been created".into());
            };

            let Some(transport) = entry.transports.get(send_transport_id) else {
                return Err("Send transport not found".into());
            };

            if source == ProducerSource::Camera
                && entry
                    .producers
                    .values()
                    .any(|producer| producer.source == ProducerSource::Camera)
            {
                return Err("Only one active camera producer is allowed per connection".into());
            }

            if source == ProducerSource::Screen
                && entry
                    .producers
                    .values()
                    .any(|producer| producer.source == ProducerSource::Screen)
            {
                return Err("Only one active screen producer is allowed per connection".into());
            }

            transport.clone()
        };

        let producer = send_transport
            .produce(ProducerOptions::new(kind, rtp_parameters))
            .await
            .map_err(|error| format!("Failed to create producer: {error}"))?;

        let producer_id = producer.id().to_string();

        {
            let media_state_lock = self.connection_media();
            let mut media_state = media_state_lock.lock().await;
            let Some(entry) = media_state.get_mut(&connection_id) else {
                return Err("Media session was closed while creating producer".into());
            };

            if entry.channel_id != channel_id {
                return Err("Media session moved to a different channel".into());
            }

            if source == ProducerSource::Camera
                && entry
                    .producers
                    .values()
                    .any(|existing| existing.source == ProducerSource::Camera)
            {
                return Err("Only one active camera producer is allowed per connection".into());
            }

            if source == ProducerSource::Screen
                && entry
                    .producers
                    .values()
                    .any(|existing| existing.source == ProducerSource::Screen)
            {
                return Err("Only one active screen producer is allowed per connection".into());
            }

            entry.producers.insert(
                producer_id.clone(),
                ProducerEntry {
                    producer,
                    source,
                    routing_mode,
                },
            );
        }

        Ok(PublishedProducer {
            producer_id,
            kind: media_kind_as_str(kind).to_string(),
            source: source.as_str().to_string(),
            routing_mode: routing_mode.as_str().to_string(),
            owner_connection_id: connection_id,
        })
    }

    pub async fn create_native_sender_session_for_connection(
        &self,
        connection_id: Uuid,
        channel_id: Uuid,
    ) -> Result<NativeSenderSession, String> {
        {
            let media_state_lock = self.connection_media();
            let media_state = media_state_lock.lock().await;
            let Some(entry) = media_state.get(&connection_id) else {
                return Err("No media session exists for this connection".into());
            };

            if entry.channel_id != channel_id {
                return Err("Native sender does not belong to this voice channel".into());
            }

            if entry
                .producers
                .values()
                .any(|producer| producer.source == ProducerSource::Screen)
            {
                return Err("Only one active screen producer is allowed per connection".into());
            }
        }

        let router = self.get_or_create_router(channel_id).await;
        let listen_info = self.native_rtp_listen_info();

        let mut plain_transport_options = PlainTransportOptions::new(listen_info);
        plain_transport_options.comedia = true;
        plain_transport_options.rtcp_mux = true;

        let plain_transport = router
            .create_plain_transport(plain_transport_options)
            .await
            .map_err(|error| format!("Failed to create native sender transport: {error}"))?;

        let tuple = plain_transport.tuple();
        let rtp_target = self.native_rtp_target_for_port(tuple.local_port());
        let ssrc = canonical_native_ssrc(connection_id);

        let producer = plain_transport
            .produce(ProducerOptions::new(
                MediaKind::Video,
                native_h264_parameters(ssrc),
            ))
            .await
            .map_err(|error| format!("Failed to create native sender producer: {error}"))?;

        let producer_id = producer.id().to_string();

        {
            let media_state_lock = self.connection_media();
            let mut media_state = media_state_lock.lock().await;
            let Some(entry) = media_state.get_mut(&connection_id) else {
                return Err("Media session was closed while creating native sender".into());
            };

            if entry.channel_id != channel_id {
                return Err("Media session moved to a different channel".into());
            }

            if entry
                .producers
                .values()
                .any(|existing| existing.source == ProducerSource::Screen)
            {
                return Err("Only one active screen producer is allowed per connection".into());
            }

            entry.producers.insert(
                producer_id.clone(),
                ProducerEntry {
                    producer,
                    source: ProducerSource::Screen,
                    routing_mode: RoutingMode::Sfu,
                },
            );
            entry
                .native_transports_by_producer
                .insert(producer_id.clone(), plain_transport);
        }

        Ok(NativeSenderSession {
            producer_id,
            kind: "video".to_string(),
            source: ProducerSource::Screen.as_str().to_string(),
            routing_mode: RoutingMode::Sfu.as_str().to_string(),
            rtp_target,
            payload_type: NATIVE_H264_PT,
            ssrc,
            mime_type: "video/H264".to_string(),
            clock_rate: NATIVE_H264_CLOCK_RATE,
            packetization_mode: NATIVE_H264_PACKETIZATION_MODE,
            profile_level_id: NATIVE_H264_PROFILE_LEVEL_ID.to_string(),
            owner_connection_id: connection_id,
        })
    }

    pub async fn list_channel_producers(
        &self,
        channel_id: Uuid,
        exclude_connection_id: Option<Uuid>,
    ) -> Vec<PublishedProducer> {
        let media_state_lock = self.connection_media();
        let media_state = media_state_lock.lock().await;

        media_state
            .iter()
            .filter_map(|(connection_id, entry)| {
                if entry.channel_id != channel_id || exclude_connection_id == Some(*connection_id) {
                    return None;
                }

                Some(
                    entry
                        .producers
                        .values()
                        .map(|producer| PublishedProducer {
                            producer_id: producer.producer.id().to_string(),
                            kind: media_kind_as_str(producer.producer.kind()).to_string(),
                            source: producer.source.as_str().to_string(),
                            routing_mode: producer.routing_mode.as_str().to_string(),
                            owner_connection_id: *connection_id,
                        })
                        .collect::<Vec<_>>(),
                )
            })
            .flatten()
            .collect()
    }

    pub async fn create_consumer_for_connection(
        &self,
        connection_id: Uuid,
        channel_id: Uuid,
        producer_id: &str,
        rtp_capabilities: RtpCapabilities,
    ) -> Result<CreatedConsumer, String> {
        let producer_id = producer_id
            .parse::<ProducerId>()
            .map_err(|_| "Invalid producer id".to_string())?;

        let (recv_transport, router) = {
            let media_state_lock = self.connection_media();
            let media_state = media_state_lock.lock().await;

            let Some(entry) = media_state.get(&connection_id) else {
                return Err("No media session exists for this connection".into());
            };

            if entry.channel_id != channel_id {
                return Err("Transport does not belong to this voice channel".into());
            }

            let Some(recv_transport_id) = entry.recv_transport_id.as_ref() else {
                return Err("Recv transport has not been created".into());
            };

            let Some(transport) = entry.transports.get(recv_transport_id) else {
                return Err("Recv transport not found".into());
            };

            let producer_in_channel = media_state.values().any(|state| {
                state.channel_id == channel_id
                    && state.producers.contains_key(&producer_id.to_string())
            });

            if !producer_in_channel {
                return Err("Producer does not belong to this voice channel".into());
            }

            let router = transport.router().clone();
            (transport.clone(), router)
        };

        if !router.can_consume(&producer_id, &rtp_capabilities) {
            return Err("Client RTP capabilities cannot consume this producer".into());
        }

        let mut consumer_options = ConsumerOptions::new(producer_id, rtp_capabilities);
        consumer_options.paused = true;

        let consumer = recv_transport
            .consume(consumer_options)
            .await
            .map_err(|error| format!("Failed to create consumer: {error}"))?;

        let created_consumer = CreatedConsumer {
            id: consumer.id().to_string(),
            producer_id: consumer.producer_id().to_string(),
            kind: media_kind_as_str(consumer.kind()).to_string(),
            rtp_parameters: consumer.rtp_parameters().clone(),
        };

        {
            let media_state_lock = self.connection_media();
            let mut media_state = media_state_lock.lock().await;
            let Some(entry) = media_state.get_mut(&connection_id) else {
                return Err("Media session was closed while creating consumer".into());
            };

            if entry.channel_id != channel_id {
                return Err("Media session moved to a different channel".into());
            }

            entry
                .consumers
                .insert(created_consumer.id.clone(), consumer);
        }

        Ok(created_consumer)
    }

    pub async fn resume_consumer_for_connection(
        &self,
        connection_id: Uuid,
        channel_id: Uuid,
        consumer_id: &str,
    ) -> Result<(), String> {
        let consumer_id = consumer_id
            .parse::<ConsumerId>()
            .map_err(|_| "Invalid consumer id".to_string())?;

        let consumer = {
            let media_state_lock = self.connection_media();
            let media_state = media_state_lock.lock().await;
            let Some(entry) = media_state.get(&connection_id) else {
                return Err("No media session exists for this connection".into());
            };

            if entry.channel_id != channel_id {
                return Err("Consumer does not belong to this voice channel".into());
            }

            let Some(consumer) = entry.consumers.get(&consumer_id.to_string()) else {
                return Err("Consumer not found".into());
            };

            consumer.clone()
        };

        consumer
            .resume()
            .await
            .map_err(|error| format!("Failed to resume consumer: {error}"))
    }

    pub async fn close_producer_for_connection(
        &self,
        connection_id: Uuid,
        channel_id: Uuid,
        producer_id: &str,
    ) -> Result<ClosedProducer, String> {
        let media_state_lock = self.connection_media();
        let mut media_state = media_state_lock.lock().await;

        let Some(entry) = media_state.get_mut(&connection_id) else {
            return Err("No media session exists for this connection".into());
        };

        if entry.channel_id != channel_id {
            return Err("Producer does not belong to this voice channel".into());
        }

        let closed = entry
            .producers
            .remove(producer_id)
            .ok_or_else(|| "Producer not found for this connection".to_string())?;

        entry.native_transports_by_producer.remove(producer_id);

        Ok(ClosedProducer {
            channel_id,
            producer_id: producer_id.to_string(),
            source: closed.source.as_str().to_string(),
            routing_mode: closed.routing_mode.as_str().to_string(),
        })
    }

    pub async fn cleanup_connection_media(&self, connection_id: Uuid) -> Vec<ClosedProducer> {
        let media_state_lock = self.connection_media();
        let mut media_state = media_state_lock.lock().await;
        let removed = media_state.remove(&connection_id);

        let Some(removed) = removed else {
            return Vec::new();
        };

        removed
            .producers
            .iter()
            .map(|(producer_id, producer)| ClosedProducer {
                channel_id: removed.channel_id,
                producer_id: producer_id.clone(),
                source: producer.source.as_str().to_string(),
                routing_mode: producer.routing_mode.as_str().to_string(),
            })
            .collect()
    }
}
