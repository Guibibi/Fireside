//! UDP socket sender — transmits RTP packets to the server PlainTransport endpoint.

use std::net::{SocketAddr, UdpSocket};

pub struct RtpSender {
    socket: UdpSocket,
    local_port: u16,
}

impl RtpSender {
    /// Bind a local UDP socket and configure the server target address.
    pub fn new(server_ip: &str, server_port: u16) -> Result<Self, String> {
        let socket =
            UdpSocket::bind("0.0.0.0:0").map_err(|e| format!("Failed to bind UDP socket: {e}"))?;

        let server_addr: SocketAddr = format!("{server_ip}:{server_port}")
            .parse()
            .map_err(|e| format!("Invalid server address: {e}"))?;

        socket
            .connect(server_addr)
            .map_err(|e| format!("Failed to connect UDP socket to server: {e}"))?;

        let local_port = socket
            .local_addr()
            .map_err(|e| format!("Failed to get local socket address: {e}"))?
            .port();

        Ok(Self { socket, local_port })
    }

    /// The local port this sender is bound to (useful for `connect_plain_transport`).
    pub fn local_port(&self) -> u16 {
        self.local_port
    }

    /// Send a single RTP packet. Errors are logged but not fatal (UDP is fire-and-forget).
    pub fn send_packet(&self, data: &[u8]) -> Result<(), String> {
        self.socket
            .send(data)
            .map(|_| ())
            .map_err(|e| format!("UDP send error: {e}"))
    }
}
