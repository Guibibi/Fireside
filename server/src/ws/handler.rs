use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};

use super::messages::{ClientMessage, ServerMessage};
use crate::auth::validate_token;
use crate::AppState;

pub async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sink, mut stream) = socket.split();

    // First message must be authentication
    let authenticated = loop {
        match stream.next().await {
            Some(Ok(Message::Text(text))) => {
                match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(ClientMessage::Authenticate { token }) => {
                        match validate_token(&token, &state.config.jwt.secret) {
                            Ok(claims) => {
                                let msg = ServerMessage::Authenticated {
                                    user_id: claims.sub,
                                    username: claims.username.clone(),
                                };
                                let json = serde_json::to_string(&msg).unwrap();
                                if sink.send(Message::Text(json.into())).await.is_err() {
                                    return;
                                }
                                break Some(claims);
                            }
                            Err(_) => {
                                let msg = ServerMessage::Error {
                                    message: "Invalid token".into(),
                                };
                                let json = serde_json::to_string(&msg).unwrap();
                                let _ = sink.send(Message::Text(json.into())).await;
                                return;
                            }
                        }
                    }
                    _ => {
                        let msg = ServerMessage::Error {
                            message: "Must authenticate first".into(),
                        };
                        let json = serde_json::to_string(&msg).unwrap();
                        let _ = sink.send(Message::Text(json.into())).await;
                        return;
                    }
                }
            }
            Some(Ok(Message::Close(_))) | None => return,
            _ => continue,
        }
    };

    let _claims = match authenticated {
        Some(c) => c,
        None => return,
    };

    // Main message loop
    while let Some(Ok(msg)) = stream.next().await {
        match msg {
            Message::Text(text) => {
                match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(client_msg) => {
                        handle_client_message(&mut sink, &state, &_claims, client_msg).await;
                    }
                    Err(e) => {
                        let err = ServerMessage::Error {
                            message: format!("Invalid message: {e}"),
                        };
                        let json = serde_json::to_string(&err).unwrap();
                        let _ = sink.send(Message::Text(json.into())).await;
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
}

async fn handle_client_message(
    sink: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    _state: &AppState,
    _claims: &crate::auth::Claims,
    msg: ClientMessage,
) {
    match msg {
        ClientMessage::SendMessage { channel_id, content } => {
            // TODO: persist message and broadcast to channel subscribers
            let response = ServerMessage::NewMessage {
                id: uuid::Uuid::new_v4(),
                channel_id,
                author_id: _claims.sub,
                content,
                created_at: chrono::Utc::now().to_rfc3339(),
            };
            let json = serde_json::to_string(&response).unwrap();
            let _ = sink.send(Message::Text(json.into())).await;
        }
        ClientMessage::JoinVoice { channel_id } => {
            let response = ServerMessage::VoiceJoined {
                channel_id,
                user_id: _claims.sub,
            };
            let json = serde_json::to_string(&response).unwrap();
            let _ = sink.send(Message::Text(json.into())).await;
        }
        ClientMessage::LeaveVoice { channel_id } => {
            let response = ServerMessage::VoiceLeft {
                channel_id,
                user_id: _claims.sub,
            };
            let json = serde_json::to_string(&response).unwrap();
            let _ = sink.send(Message::Text(json.into())).await;
        }
        ClientMessage::MediaSignal { channel_id, payload } => {
            let response = ServerMessage::MediaSignal {
                channel_id,
                payload,
            };
            let json = serde_json::to_string(&response).unwrap();
            let _ = sink.send(Message::Text(json.into())).await;
        }
        ClientMessage::Authenticate { .. } => {
            let err = ServerMessage::Error {
                message: "Already authenticated".into(),
            };
            let json = serde_json::to_string(&err).unwrap();
            let _ = sink.send(Message::Text(json.into())).await;
        }
    }
}
