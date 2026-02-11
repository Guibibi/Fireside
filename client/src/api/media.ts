import { Device } from "mediasoup-client";
import type { Transport, Producer, Consumer } from "mediasoup-client/lib/types";
import { send, onMessage } from "./ws";

let device: Device | null = null;
let sendTransport: Transport | null = null;
let recvTransport: Transport | null = null;

const producers = new Map<string, Producer>();
const consumers = new Map<string, Consumer>();

export async function loadDevice(routerRtpCapabilities: unknown) {
  device = new Device();
  await device.load({ routerRtpCapabilities: routerRtpCapabilities as Parameters<Device["load"]>[0]["routerRtpCapabilities"] });
}

export function getDevice(): Device | null {
  return device;
}

export function getSendTransport(): Transport | null {
  return sendTransport;
}

export function getRecvTransport(): Transport | null {
  return recvTransport;
}

export function setSendTransport(t: Transport) {
  sendTransport = t;
}

export function setRecvTransport(t: Transport) {
  recvTransport = t;
}

export function addProducer(id: string, producer: Producer) {
  producers.set(id, producer);
}

export function addConsumer(id: string, consumer: Consumer) {
  consumers.set(id, consumer);
}

export function cleanup() {
  producers.forEach((p) => p.close());
  consumers.forEach((c) => c.close());
  sendTransport?.close();
  recvTransport?.close();
  producers.clear();
  consumers.clear();
  sendTransport = null;
  recvTransport = null;
  device = null;
}

// Placeholder: join a voice channel via signaling
export function joinVoiceChannel(channelId: string) {
  send({ type: "join_voice", channel_id: channelId });

  const unsub = onMessage((msg) => {
    if (msg.type === "media_signal") {
      // TODO: handle media signaling responses
      console.log("Media signal received:", msg.payload);
    }
  });

  return unsub;
}

export function leaveVoiceChannel(channelId: string) {
  send({ type: "leave_voice", channel_id: channelId });
  cleanup();
}
