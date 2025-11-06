document.addEventListener("DOMContentLoaded", () => {

  const socket = io("https://twin-canvas.onrender.com");

  const urlParams = new URLSearchParams(window.location.search);
  const room = urlParams.get("room");
  const userName = localStorage.getItem("twinCanvasUserName") || "Anonymous";

  const videoPlayer = document.getElementById("moviePlayer");
  const fileInput   = document.getElementById("fileInput");
  const playBtn     = document.getElementById("playPauseBtn");
  const skipBtn     = document.getElementById("skipBtn");
  const backBtn     = document.getElementById("reverseBtn");

  const audioContainer = document.getElementById("audio-container");

  const peerConnections = {};
  let movieStream;
  let localStream;
  let isBroadcaster = false;

  const config = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  };

  if (!room) { window.location.href = "index.html"; return; }

  socket.emit("join_movie_room", { room, userName });

  socket.on("movie-users", ids => {
    ids.forEach(id => createAndSendOffer(id));
  });

  function createPeer(id) {
    const pc = new RTCPeerConnection(config);
    peerConnections[id] = pc;

    if (movieStream) {
      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    }

    pc.ontrack = ({ streams }) => {
      videoPlayer.srcObject = streams[0];
      videoPlayer.muted = false;
      videoPlayer.play().catch(()=>{});
    };

    pc.onicecandidate = e => {
      if (e.candidate)
        socket.emit("movie-ice", { room, to: id, candidate: e.candidate });
    };

    return pc;
  }

  async function createAndSendOffer(id) {
    const pc = createPeer(id);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("movie-offer", { room, to: id, offer });
  }

  socket.on("movie-offer", async ({ from, offer }) => {
    const pc = peerConnections[from] || createPeer(from);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("movie-answer", { room, to: from, answer });
  });

  socket.on("movie-answer", async ({ from, answer }) => {
    const pc = peerConnections[from];
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  });

  socket.on("movie-ice", async ({ from, candidate }) => {
    const pc = peerConnections[from];
    pc?.addIceCandidate(new RTCIceCandidate(candidate));
  });

  // ✅ Select file & stream it
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    isBroadcaster = true;
    videoPlayer.src = URL.createObjectURL(file);
    await videoPlayer.play().catch(()=>{});

    movieStream = videoPlayer.captureStream();

    // renegotiate with all
    for (const id of Object.keys(peerConnections)) {
      const pc = peerConnections[id];
      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("movie-offer", { room, to: id, offer });
    }
  });

  // ✅ Play/Pause Sync
  playBtn.addEventListener("click", () => {
    if (videoPlayer.paused) {
      videoPlayer.play();
      socket.emit("movie_play", { room });
    } else {
      videoPlayer.pause();
      socket.emit("movie_pause", { room });
    }
  });

  socket.on("movie_play", () => videoPlayer.play().catch(()=>{}));
  socket.on("movie_pause", () => videoPlayer.pause());

  // ✅ Seeking
  skipBtn.addEventListener("click", () => {
    videoPlayer.currentTime += 10;
    socket.emit("movie_seek", { room, time: videoPlayer.currentTime });
  });

  backBtn.addEventListener("click", () => {
    videoPlayer.currentTime -= 10;
    socket.emit("movie_seek", { room, time: videoPlayer.currentTime });
  });

  socket.on("movie_seek", (time) => {
    videoPlayer.currentTime = time;
  });

});
