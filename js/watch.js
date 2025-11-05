document.addEventListener('DOMContentLoaded', () => {

  const socket = io('https://twin-canvas.onrender.com'); // your signaling server

  let movieStream;
  let localStream;                // mic (optional)
  let isBroadcaster = false;
  const peerConnections = {};     // socketId -> RTCPeerConnection

  const configuration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  const urlParams = new URLSearchParams(window.location.search);
  const room = urlParams.get('room');
  const userName = localStorage.getItem('twinCanvasUserName') || 'Anonymous';

  const videoPlayer = document.getElementById('moviePlayer');
  const fileInput   = document.getElementById('fileInput');
  const filePrompt  = document.getElementById('filePrompt');

  const playPauseBtn = document.getElementById('playPauseBtn');
  const skipBtn      = document.getElementById('skipBtn');
  const reverseBtn   = document.getElementById('reverseBtn');

  const micBtn        = document.getElementById('micBtn');
  const audioContainer= document.getElementById('audio-container');
  const initialsContainer = document.getElementById('userInitials');

  if (!room) { window.location.href = 'index.html'; return; }

  // ✅ Join movie room
  socket.emit('join_movie_room', { room, userName });

  // ✅ Immediately request peer list (ensures User-2 sees video even without mic)
  socket.emit("request-peers", { room });

  function nameToColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++)
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const hue = ((hash % 360) + 360) % 360;
    return `hsl(${hue}, 70%, 60%)`;
  }

  function playAllBlockedAudio() {
    audioContainer.querySelectorAll('audio').forEach(a => {
      a.play().catch(()=>{});
    });
  }

  // ----------------------------------------------------
  // CREATE / GET PEER CONNECTION
  // ----------------------------------------------------
  function getOrCreatePC(socketId) {
    let pc = peerConnections[socketId];
    if (pc) return pc;

    pc = new RTCPeerConnection(configuration);
    peerConnections[socketId] = pc;

    // attach mic tracks
    if (localStream) {
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }
    // attach movie tracks
    if (isBroadcaster && movieStream) {
      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate)
        socket.emit('ice-candidate', { room, to: socketId, candidate: e.candidate });
    };

    pc.ontrack = ({ streams }) => {
      const stream = streams[0];

      // ✅ MOVIE STREAM (video + movie audio)
      if (stream.getVideoTracks().length > 0) {
        filePrompt.style.display = 'none';
        videoPlayer.srcObject = stream;
        videoPlayer.muted = false;

        videoPlayer.play().catch(() => {
          const btn = document.createElement("button");
          btn.textContent = "🔊 Tap to enable sound";
          btn.style = `
            position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
            background: #7c5cff; color: white; border: none;
            padding: 12px 20px; border-radius: 10px; cursor: pointer; font-size: 16px;
          `;
          document.body.appendChild(btn);
          btn.onclick = () => {
            videoPlayer.play().then(() => btn.remove());
            playAllBlockedAudio();
          };
        });

        playPauseBtn.disabled = false;
        skipBtn.disabled      = false;
        reverseBtn.disabled   = false;
      }

      // ✅ MIC AUDIO STREAM (no echo)
      if (stream.getVideoTracks().length === 0) {
        let audio = document.getElementById(`audio-${socketId}`);
        if (!audio) {
          audio = document.createElement("audio");
          audio.id = `audio-${socketId}`;
          audio.controls = false;
          audio.autoplay = true;
          audioContainer.appendChild(audio);
        }
        audio.srcObject = stream;

        // ✅ Prevent echo: mute our own mic playback
        if (socketId === socket.id) {
          audio.muted = true;
          audio.volume = 0;
        }
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

  // ----------------------------------------------------
  // MOVIE FILE SELECTED (HOST ONLY)
  // ----------------------------------------------------
  fileInput.addEventListener('change', async () => {
    isBroadcaster = true;
    const file = fileInput.files[0];
    if (!file) return;

    videoPlayer.src = URL.createObjectURL(file);
    videoPlayer.muted = true; // host avoids echo
    await videoPlayer.play().catch(()=>{});
    filePrompt.style.display = 'none';

    playAllBlockedAudio();

    movieStream = videoPlayer.captureStream();

    for (const id of Object.keys(peerConnections)) {
      const pc = getOrCreatePC(id);
      const localMicTrack = localStream ? localStream.getAudioTracks()[0] : null;

      pc.getSenders()
        .filter(s => s.track && s.track.kind === 'video')
        .forEach(s => pc.removeTrack(s));

      pc.getSenders()
        .filter(s => s.track && s.track.kind === 'audio' && s.track !== localMicTrack)
        .forEach(s => pc.removeTrack(s));

      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    }
    await renegotiateAll();
  });

  // ----------------------------------------------------
  // VIDEO CONTROLS SYNC
  // ----------------------------------------------------
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
    const t = videoPlayer.currentTime + 10;
    videoPlayer.currentTime = t;
    socket.emit('video_seek', { room, time: t });
  });
  reverseBtn.addEventListener('click', () => {
    const t = videoPlayer.currentTime - 10;
    videoPlayer.currentTime = t;
    socket.emit('video_seek', { room, time: t });
  });

  socket.on('video_play', () => videoPlayer.play().catch(()=>{}));
  socket.on('video_pause', () => videoPlayer.pause());
  socket.on('video_seek', (t) => {
    if (Math.abs(videoPlayer.currentTime - t) > 1)
      videoPlayer.currentTime = t;
  });

  // ----------------------------------------------------
  // MIC BUTTON
  // ----------------------------------------------------
  let micOn = false;
  micBtn.addEventListener('click', async () => {
    micOn = !micOn;
    const icon = micBtn.querySelector('i');

    if (micOn && !localStream) {
      try {
        // ✅ ECHO REMOVED (noise + cancellation)
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

        // let others know we can join voice
        socket.emit('ready-for-voice', { room });
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

  // ----------------------------------------------------
  // USER ICONS
  // ----------------------------------------------------
  socket.on('update_users', (names) => {
    initialsContainer.innerHTML = '';
    names.forEach(name => {
      const div = document.createElement('div');
      div.className = 'initial-circle';
      div.textContent = name.charAt(0).toUpperCase();
      div.style.backgroundColor = nameToColor(name);
      div.title = name;
      initialsContainer.appendChild(div);
    });
  });

  // ✅ NEW: ensures User-2 sees movie even if mic off
  socket.on("peer-list", (ids) => {
    ids.forEach(id => {
      if (id !== socket.id) sendOffer(id);
    });
  });

  // ----------------------------------------------------
  // SIGNALING (VOICE CHAT)
  // ----------------------------------------------------
  socket.on('existing-voice-users', (ids) => {
    ids.forEach(id => {
      if (id !== socket.id) sendOffer(id);
    });
  });

  socket.on('user-joined-voice', ({ socketId }) => {
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
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch{}
  });

  socket.on('user-left-voice', (id) => {
    peerConnections[id]?.close();
    delete peerConnections[id];
    document.getElementById(`audio-${id}`)?.remove();
  });

});
