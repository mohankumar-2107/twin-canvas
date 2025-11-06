document.addEventListener("DOMContentLoaded", () => {

  const socket = io("https://twin-canvas.onrender.com");

  const urlParams = new URLSearchParams(window.location.search);
  const room = urlParams.get("room");
  const userName = localStorage.getItem("twinCanvasUserName") || "Anonymous";

  const videoPlayer = document.getElementById("moviePlayer");
  const fileInput   = document.getElementById("fileInput");
  const customBtn   = document.getElementById("customUploadBtn");
  const filePrompt  = document.getElementById("filePrompt");

  const playBtn = document.getElementById("playPauseBtn");
  const skipBtn = document.getElementById("skipBtn");
  const backBtn = document.getElementById("reverseBtn");

  const initialsContainer = document.getElementById("userInitials");
  const audioContainer = document.getElementById("audio-container");

  let movieStream;
  const peers = {};
  const config = { iceServers: [{ urls:"stun:stun.l.google.com:19302" }] };

  if (!room) { window.location.href = "index.html"; return; }

  socket.emit("join_movie_room", { room, userName });

  customBtn.onclick = () => fileInput.click();

  socket.on("update_users", (names) => {
    initialsContainer.innerHTML = "";
    names.forEach(name => {
      const c = document.createElement("div");
      c.className = "initial-circle";
      c.style.background = nameToColor(name);
      c.textContent = name[0].toUpperCase();
      initialsContainer.appendChild(c);
    });
  });

  socket.on("movie-users", ids => {
    ids.forEach(id => sendOffer(id));
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    videoPlayer.src = URL.createObjectURL(file);
    await videoPlayer.play();

    movieStream = videoPlayer.captureStream();
    filePrompt.style.display = "none";

    for (const id of Object.keys(peers)) {
      const pc = peers[id];
      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("movie-offer", { room, to:id, offer });
    }
  });

  function createPeer(id) {
    const pc = new RTCPeerConnection(config);
    peers[id] = pc;

    pc.ontrack = ({streams}) => {
      videoPlayer.srcObject = streams[0];
      videoPlayer.play().catch(()=>{});
    };

    pc.onicecandidate = e => {
      if (e.candidate) socket.emit("movie-ice", { room, to:id, candidate:e.candidate });
    };

    return pc;
  }

  async function sendOffer(id) {
    const pc = createPeer(id);
    if (movieStream) movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("movie-offer", { room, to:id, offer });
  }

  socket.on("movie-offer", async ({ from, offer }) => {
    const pc = peers[from] || createPeer(from);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("movie-answer", { room, to:from, answer });
  });

  socket.on("movie-answer", async ({ from, answer }) => {
    await peers[from].setRemoteDescription(new RTCSessionDescription(answer));
  });

  socket.on("movie-ice", async ({ from, candidate }) => {
    peers[from]?.addIceCandidate(new RTCIceCandidate(candidate));
  });

  playBtn.onclick = () => {
    if (videoPlayer.paused) {
      videoPlayer.play();
      socket.emit("movie_play", { room });
    } else {
      videoPlayer.pause();
      socket.emit("movie_pause", { room });
    }
  };

  skipBtn.onclick = () => {
    videoPlayer.currentTime += 10;
    socket.emit("movie_seek", { room, time: videoPlayer.currentTime });
  };

  backBtn.onclick = () => {
    videoPlayer.currentTime -= 10;
    socket.emit("movie_seek", { room, time: videoPlayer.currentTime });
  };

  socket.on("movie_play", () => videoPlayer.play().catch(()=>{}));
  socket.on("movie_pause", () => videoPlayer.pause());
  socket.on("movie_seek", (time) => videoPlayer.currentTime = time);

  function nameToColor(name) {
    let hash = 0;
    for (let i=0;i<name.length;i++) hash = name.charCodeAt(i)+((hash<<5)-hash);
    return `hsl(${hash % 360}, 70%, 60%)`;
  }

});
