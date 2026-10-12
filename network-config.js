// Optional PeerJS configuration, shared by the host and guests.
// Do not commit permanent TURN passwords or provider API keys here.
export const peerOptions={};

// Optional HTTPS endpoint returning temporary WebRTC ICE credentials:
// {"iceServers":[{"urls":"turns:YOUR_SERVER:443","username":"...","credential":"..."}]}
// Also accepts a plain RTCIceServer array. Must allow this site's origin (CORS).
// Keep the provider's API key on that endpoint's server, not in its public URL.
export const iceServersUrl='';
