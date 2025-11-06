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
document.addEventListener('DOMContentLoaded', () => {

  const socket = io('https://twin-canvas.onrender.com');

  let movieStream;
  let localStream;
  let isBroadcaster = false;
  const peerConnections = {};
  const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  const urlParams = new URLSearchParams(window.location.search);
  const room = urlParams.get('room');
  const userName = localStorage.getItem('twinCanvasUserName') || 'Anonymous';

  const videoPlayer = document.getElementById('moviePlayer');
  const fileInput = document.getElementById('fileInput');
  const filePrompt = document.getElementById('filePrompt');

  const playPauseBtn = document.getElementById('playPauseBtn');
  const skipBtn = document.getElementById('skipBtn');
  const reverseBtn = document.getElementById('reverseBtn');

  const micBtn = document.getElementById('micBtn');
  const audioContainer = document.getElementById('audio-container');

  if (!room) { window.location.href = 'index.html'; return; }

  socket.emit('join_movie_room', { room, userName });

  // ✅ Fix reverse broadcasting
  socket.on("movie-users", (ids) => {
    console.log("[watch] movie-users ->", ids);
    ids.forEach(id => sendOffer(id));
  });

  // ✅ nameToColor FIX (logos working again)
  function nameToColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 60%)`;
  }

  function playAllBlockedAudio() {
    audioContainer.querySelectorAll('audio').forEach(a => a.play().catch(() => {}));
  }

  function getOrCreatePC(socketId) {
    let pc = peerConnections[socketId];
    if (pc) return pc;

    pc = new RTCPeerConnection(configuration);
    peerConnections[socketId] = pc;

    // add mic
    if (localStream) {
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }
    // add movie
    if (isBroadcaster && movieStream) {
      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    }

    pc.onicecandidate = e => {
      if (e.candidate) socket.emit('ice-candidate', { room, to: socketId, candidate: e.candidate });
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];

      // ✅ MOVIE STREAM
      if (stream.getVideoTracks().length > 0) {
        filePrompt.style.display = 'none';
        videoPlayer.srcObject = stream;
        videoPlayer.muted = false;
        videoPlayer.play().catch(() => {});
        playPauseBtn.disabled = false;
        skipBtn.disabled = false;
        reverseBtn.disabled = false;
      }

      // ✅ MIC STREAM
      else {
        let audio = document.getElementById(`audio-${socketId}`);
        if (!audio) {
          audio = document.createElement('audio');
          audio.id = `audio-${socketId}`;
          audio.controls = false;
          audioContainer.appendChild(audio);
        }
        audio.srcObject = stream;
        audio.play().catch(() => {});
      }
    };

    return pc;
  }

  async function sendOffer(to) {
    const pc = getOrCreatePC(to);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('voice-offer', { room, to, offer: pc.localDescription });
  }

  async function renegotiateAll() {
    for (const id of Object.keys(peerConnections)) {
      await sendOffer(id);
    }
  }

  // ✅ File Upload Logic (Both sides)
  fileInput.addEventListener('change', async () => {
    isBroadcaster = true;
    const file = fileInput.files[0];
    if (!file) return;

    videoPlayer.src = URL.createObjectURL(file);
    videoPlayer.muted = false;

    await videoPlayer.play().catch(() => {});
    filePrompt.style.display = 'none';
    playAllBlockedAudio();

    movieStream = videoPlayer.captureStream
      ? videoPlayer.captureStream()
      : videoPlayer.mozCaptureStream
        ? videoPlayer.mozCaptureStream()
        : null;

    if (!movieStream) {
      alert("Your browser does not support streaming this video.");
      return;
    }

    if (Object.keys(peerConnections).length === 0) {
      socket.emit("request_movie_users", { room });
    } else {
      for (const id of Object.keys(peerConnections)) {
        const pc = getOrCreatePC(id);

        // remove old tracks
        pc.getSenders()
          .filter(s => s.track && s.track.kind === 'video')
          .forEach(s => pc.removeTrack(s));

        movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
      }
      await renegotiateAll();
    }
  });

  // ✅ Playback Sync
  playPauseBtn.addEventListener('click', () => {
    if (videoPlayer.paused) {
      videoPlayer.play();
      socket.emit('video_play', { room });
    } else {
      videoPlayer.pause();
      socket.emit('video_pause', { room });
    }
  });

  skipBtn.addEventListener('click', () => {
    videoPlayer.currentTime += 10;
    socket.emit('video_seek', { room, time: videoPlayer.currentTime });
  });

  reverseBtn.addEventListener('click', () => {
    videoPlayer.currentTime -= 10;
    socket.emit('video_seek', { room, time: videoPlayer.currentTime });
  });

  socket.on('video_play', () => videoPlayer.play().catch(()=>{}));
  socket.on('video_pause', () => videoPlayer.pause());
  socket.on('video_seek', (time) => videoPlayer.currentTime = time);

  // ✅ Mic
  let micOn = false;
  micBtn.addEventListener('click', async () => {
    micOn = !micOn;
    const icon = micBtn.querySelector('i');

    if (micOn && !localStream) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true }});
        socket.emit('ready-for-voice', { room });
        for (const id of Object.keys(peerConnections)) {
          const pc = getOrCreatePC(id);
          localStream.getAudioTracks().forEach(t => pc.addTrack(t, localStream));
        }
        await renegotiateAll();
        playAllBlockedAudio();

      } catch (e) {
        console.error("Mic blocked:", e);
        micOn = false;
      }
    }

    if (localStream) {
      localStream.getTracks().forEach(t => t.enabled = micOn);
    }

    icon.className = micOn ? 'fas fa-microphone' : 'fas fa-microphone-slash';
  });

  // ✅ Logos fixed
  socket.on('update_users', (userNames) => {
    const initialsContainer = document.getElementById('userInitials');
    initialsContainer.innerHTML = '';
    userNames.forEach(name => {
      const el = document.createElement('div');
      el.className = 'initial-circle';
      el.textContent = name.charAt(0).toUpperCase();
      el.style.backgroundColor = nameToColor(name);
      initialsContainer.appendChild(el);
    });
  });

  // ✅ Voice signaling
  socket.on('existing-voice-users', (ids) => {
    if (!localStream) return;
    ids.forEach(id => {
      if (id !== socket.id) sendOffer(id);
    });
  });

  socket.on('user-joined-voice', ({ socketId }) => {
    if (!localStream) return;
    if (socketId !== socket.id) sendOffer(socketId);
  });

  socket.on('voice-offer', async ({ from, offer }) => {
    const pc = getOrCreatePC(from);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('voice-answer', { room, to: from, answer: pc.localDescription });
  });

  socket.on('voice-answer', async ({ from, answer }) => {
    const pc = getOrCreatePC(from);
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  });

  socket.on('ice-candidate', async ({ from, candidate }) => {
    const pc = getOrCreatePC(from);
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
  });

  socket.on('user-left-voice', (socketId) => {
    peerConnections[socketId]?.close();
    delete peerConnections[socketId];
    document.getElementById(`audio-${socketId}`)?.remove();
  });

});
