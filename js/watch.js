document.addEventListener("DOMContentLoaded", () => {
  const socket = io("https://twin-canvas.onrender.com");

  const videoPlayer = document.getElementById("moviePlayer");
  const fileInput = document.getElementById("fileInput");
  const filePrompt = document.getElementById("filePrompt");

  const playPauseBtn = document.getElementById("playPauseBtn");
  const reverseBtn = document.getElementById("reverseBtn");
  const skipBtn = document.getElementById("skipBtn");

  const timeline = document.getElementById("timeline");
  const currentTimeLabel = document.getElementById("currentTime");
  const durationLabel = document.getElementById("duration");

  let localStream = null;
  let movieStream = null;
  let isBroadcaster = false;

  const peerConnections = {};
  const config = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  };

  const params = new URLSearchParams(window.location.search);
  const room = params.get("room");
  if (!room) location.href = "index.html";

  socket.emit("join_movie_room", { room });

  // ✅ Ask server who is here
  socket.on("movie-users", (ids) => {
    console.log("[watch] movie-users ->", ids);
    ids.forEach(id => {
      sendOffer(id); // each new user sends offer
    });
  });

  /** CREATE PEER */
  function getPC(id) {
    if (peerConnections[id]) return peerConnections[id];

    const pc = new RTCPeerConnection(config);
    peerConnections[id] = pc;

    if (movieStream) {
      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    }
    if (localStream) {
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit("ice-candidate", { room, to: id, candidate: e.candidate });
      }
    };

    pc.ontrack = ({ streams }) => {
      const stream = streams[0];

      // ✅ MOVIE RECEIVED
      if (stream.getVideoTracks().length > 0) {
        console.log("[watch] Received movie stream");
        filePrompt.style.display = "none";
        videoPlayer.srcObject = stream;
        videoPlayer.muted = false;
        videoPlayer.play().catch(() => {});

      } else {
        // ✅ MIC AUDIO
        let audio = document.getElementById(`audio-${id}`);
        if (!audio) {
          audio = document.createElement("audio");
          audio.id = `audio-${id}`;
          audioContainer.appendChild(audio);
        }
        audio.srcObject = stream;
        audio.play().catch(() => {});
      }
    };

    return pc;
  }

  /** SEND OFFER */
  async function sendOffer(to) {
    const pc = getPC(to);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("voice-offer", { room, to, offer });
  }

  /** ANSWER OFFER */
  socket.on("voice-offer", async ({ from, offer }) => {
    const pc = getPC(from);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("voice-answer", { room, to: from, answer });
  });

  socket.on("voice-answer", async ({ from, answer }) => {
    const pc = getPC(from);
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  });

  socket.on("ice-candidate", async ({ from, candidate }) => {
    const pc = getPC(from);
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  });

  /** ✅ FILE SELECT (MOVIE SEND) */
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    isBroadcaster = true;
    videoPlayer.src = URL.createObjectURL(file);
    await videoPlayer.play().catch(() => {});
    filePrompt.style.display = "none";

    // ✅ capture with audio
    movieStream = videoPlayer.captureStream();

    for (const id of Object.keys(peerConnections)) {
      const pc = getPC(id);
      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    }

    for (const id of Object.keys(peerConnections)) {
      sendOffer(id);
    }

    // ✅ ask server for missing users
    socket.emit("request_movie_users", { room });
  });

  /** ✅ PLAYBACK SYNC */
  playPauseBtn.addEventListener("click", () => {
    if (videoPlayer.paused) {
      videoPlayer.play();
      socket.emit("video_play", { room });
    } else {
      videoPlayer.pause();
      socket.emit("video_pause", { room });
    }
  });

  reverseBtn.addEventListener("click", () => {
    const t = videoPlayer.currentTime - 10;
    videoPlayer.currentTime = t;
    socket.emit("video_seek", { room, time: t });
  });

  skipBtn.addEventListener("click", () => {
    const t = videoPlayer.currentTime + 10;
    videoPlayer.currentTime = t;
    socket.emit("video_seek", { room, time: t });
  });

  socket.on("video_play", () => videoPlayer.play().catch(()=>{}));
  socket.on("video_pause", () => videoPlayer.pause());
  socket.on("video_seek", (t) => {
    if (Math.abs(videoPlayer.currentTime - t) > 0.5) {
      videoPlayer.currentTime = t;
    }
  });

  /** ✅ TIMELINE UI */
  function fmt(sec){
    sec = Math.floor(sec);
    const m = Math.floor(sec/60);
    const s = sec%60;
    return `${m}:${s<10?'0'+s:s}`;
  }

  videoPlayer.addEventListener("loadedmetadata", () => {
    timeline.max = videoPlayer.duration;
    durationLabel.textContent = fmt(videoPlayer.duration);
  });

  videoPlayer.addEventListener("timeupdate", () => {
    if (!timeline.matches(":active")) {
      timeline.value = videoPlayer.currentTime;
    }
    currentTimeLabel.textContent = fmt(videoPlayer.currentTime);
  });

  timeline.addEventListener("input", () => {
    videoPlayer.currentTime = timeline.value;
    socket.emit("video_seek", { room, time: timeline.value });
  });

  timeline.addEventListener("mousedown", () => {
    videoPlayer.pause();
    socket.emit("video_pause", { room });
  });
});
