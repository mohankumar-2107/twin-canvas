document.addEventListener('DOMContentLoaded', () => {

  const socket = io('https://twin-canvas.onrender.com');

  let movieStream;
  let localStream;
  let isBroadcaster = false;
  const peerConnections = {};
  const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  const urlParams = new URLSearchParams(window.location.search);
  const room = urlParams.get('room');
  const userName = localStorage.getItem('twinCanvasUserName') || 'Anonymous';

  const videoPlayer = document.getElementById('moviePlayer');
  const fileInput = document.getElementById('fileInput');
  const filePrompt = document.getElementById('filePrompt');

  const playPauseBtn = document.getElementById('playPauseBtn');
  const skipBtn = document.getElementById('skipBtn');
  const reverseBtn = document.getElementById('reverseBtn');
  const timeline = document.getElementById('timeline');

  const micBtn = document.getElementById('micBtn');
  const audioContainer = document.getElementById('audio-container');

  const userInitials = document.getElementById('userInitials');

  if (!room) { window.location.href = 'index.html'; return; }

  socket.emit('join_movie_room', { room, userName });

  socket.on("movie-users", (ids) => {
    console.log("[watch] movie-users ->", ids);
    ids.forEach(id => sendOffer(id));
  });

  function playAllBlockedAudio() {
    audioContainer.querySelectorAll('audio').forEach(a => {
      a.play().catch(()=>{});
    });
  }

  function nameToColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 60%)`;
  }

  function getOrCreatePC(id) {
    let pc = peerConnections[id];
    if (pc) return pc;

    pc = new RTCPeerConnection(config);
    peerConnections[id] = pc;

    if (localStream) {
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }
    if (isBroadcaster && movieStream) {
      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    }

    pc.onicecandidate = e => {
      if (e.candidate)
        socket.emit('ice-candidate', { room, to: id, candidate: e.candidate });
    };

    pc.ontrack = evt => {
      const stream = evt.streams[0];

      // If stream contains video → movie stream
      if (stream.getVideoTracks().length > 0) {
        filePrompt.style.display = 'none';
        videoPlayer.srcObject = stream;
        videoPlayer.muted = false;

        videoPlayer.play().catch(() => {
          showEnableAudioButton();
        });

        playPauseBtn.disabled = false;
        skipBtn.disabled = false;
        reverseBtn.disabled = false;
      } else {
        // Voice
        let audio = document.getElementById(`audio-${id}`);
        if (!audio) {
          audio = document.createElement('audio');
          audio.id = `audio-${id}`;
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
    for (const id of Object.keys(peerConnections))
      sendOffer(id);
  }

  function showEnableAudioButton() {
    const btn = document.createElement('button');
    btn.textContent = "🔊 Tap to enable sound";
    btn.style = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #7c5cff;
      color: white;
      border: none;
      padding: 12px 20px;
      border-radius: 10px;
      cursor: pointer;
      font-size: 16px;
      z-index: 9999;
    `;
    document.body.appendChild(btn);
    btn.onclick = () => {
      videoPlayer.play().then(()=>btn.remove());
      playAllBlockedAudio();
    };
  }

  // ✅ FILE SELECT
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    isBroadcaster = true;
    videoPlayer.src = URL.createObjectURL(file);
    videoPlayer.muted = false;
    await videoPlayer.play().catch(()=>{});
    filePrompt.style.display = 'none';
    playAllBlockedAudio();

    movieStream = videoPlayer.captureStream();

    if (Object.keys(peerConnections).length === 0) {
      socket.emit("request_movie_users", { room });
    } else {
      for (const id of Object.keys(peerConnections)) {
        const pc = getOrCreatePC(id);

        const localAudioTrack = localStream ? localStream.getAudioTracks()[0] : null;

        pc.getSenders().filter(s => s.track && s.track.kind === 'video')
          .forEach(s => pc.removeTrack(s));

        pc.getSenders().filter(s => {
          return s.track && s.track.kind === 'audio' && s.track !== localAudioTrack;
        }).forEach(s => pc.removeTrack(s));

        movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
      }
      renegotiateAll();
    }
  });

  // ✅ PLAY / PAUSE
  playPauseBtn.addEventListener('click', () => {
    if (videoPlayer.paused) {
      videoPlayer.play();
      socket.emit('video_play', { room });
    } else {
      videoPlayer.pause();
      socket.emit('video_pause', { room });
    }
  });

  socket.on('video_play', () => {
    if (videoPlayer.paused) videoPlayer.play().catch(()=>{});
  });

  socket.on('video_pause', () => {
    if (!videoPlayer.paused) videoPlayer.pause();
  });

  // ✅ TIMELINE SEEK + DRAG
  videoPlayer.addEventListener('loadedmetadata', () => {
    timeline.max = videoPlayer.duration;
  });

  videoPlayer.addEventListener('timeupdate', () => {
    if (!timeline.matches(':active')) {
      timeline.value = videoPlayer.currentTime;
    }
  });

  timeline.addEventListener('input', () => {
    videoPlayer.currentTime = timeline.value;
    socket.emit('video_seek', { room, time: timeline.value });
  });

  // ✅ Pause on tap timeline
  timeline.addEventListener('mousedown', () => {
    videoPlayer.pause();
    socket.emit('video_pause', { room });
  });

  socket.on('video_seek', (t) => {
    if (Math.abs(videoPlayer.currentTime - t) > 1)
      videoPlayer.currentTime = t;
  });

  // ✅ DOUBLE-TAP GESTURES
  let lastTap = 0;
  videoPlayer.addEventListener('click', (e) => {
    const now = Date.now();
    if (now - lastTap < 300) {
      // double tap
      const rect = videoPlayer.getBoundingClientRect();
      const x = e.clientX - rect.left;

      if (x < rect.width / 2) {
        // left = reverse
        const t = videoPlayer.currentTime - 10;
        videoPlayer.currentTime = t;
        socket.emit('video_seek', { room, time: t });
      } else {
        // right = forward
        const t = videoPlayer.currentTime + 10;
        videoPlayer.currentTime = t;
        socket.emit('video_seek', { room, time: t });
      }
    } else {
      // single tap = play/pause
      if (videoPlayer.paused) {
        videoPlayer.play();
        socket.emit('video_play', { room });
      } else {
        videoPlayer.pause();
        socket.emit('video_pause', { room });
      }
    }
    lastTap = now;
  });

  // ✅ SKIP BUTTONS
  skipBtn.addEventListener('click', () => {
    const t = videoPlayer.currentTime + 10;
    videoPlayer.currentTime = t;
    socket.emit('video_seek', { room, time: t });
  });

  reverseBtn.addEventListener('click', () => {
    const t = videoPlayer.currentTime - 10;
    videoPlayer.currentTime = t;
    socket.emit('video_seek', { room, time: t });
  });

  // ✅ MIC
  let micOn = false;
  micBtn.addEventListener('click', async () => {
    micOn = !micOn;
    micBtn.querySelector('i').className = micOn ? 'fas fa-microphone' : 'fas fa-microphone-slash';

    if (micOn && !localStream) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true }});        
        socket.emit('ready-for-voice', { room });

        for (const id of Object.keys(peerConnections)) {
          const pc = getOrCreatePC(id);
          localStream.getAudioTracks().forEach(t => pc.addTrack(t, localStream));
        }
        renegotiateAll();
        playAllBlockedAudio();

      } catch (e) {
        console.error("Mic blocked:", e);
        micOn = false;
      }
    }

    if (localStream)
      localStream.getTracks().forEach(t => t.enabled = micOn);
  });

  // ✅ LOGOS
  socket.on('update_users', (names) => {
    userInitials.innerHTML = '';
    names.forEach(name => {
      const circle = document.createElement('div');
      circle.className = 'initial-circle';
      circle.textContent = name.charAt(0).toUpperCase();
      circle.title = name;
      circle.style.backgroundColor = nameToColor(name);
      userInitials.appendChild(circle);
    });
  });

  // ✅ VOICE SIGNALING
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
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    socket.emit('voice-answer', { room, to: from, answer: pc.localDescription });
  });

  socket.on('voice-answer', async ({ from, answer }) => {
    const pc = getOrCreatePC(from);
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  });

  socket.on('ice-candidate', async ({ from, candidate }) => {
    const pc = getOrCreatePC(from);
    if (candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate));
  });

  socket.on('user-left-voice', (id) => {
    peerConnections[id]?.close();
    delete peerConnections[id];
    document.getElementById(`audio-${id}`)?.remove();
  });

});
