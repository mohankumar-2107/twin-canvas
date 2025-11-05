// watch.js
document.addEventListener('DOMContentLoaded', () => {
  const socket = io('https://twin-canvas.onrender.com'); // your Render URL

  let movieStream;
  let localStream;        // optional mic
  let isBroadcaster = false;
  let isSyncing = false;

  const peerConnections = {};  // socketId -> RTCPeerConnection
  const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  const urlParams   = new URLSearchParams(window.location.search);
  const room        = urlParams.get('room');
  const userName    = localStorage.getItem('twinCanvasUserName') || 'Anonymous';

  const videoPlayer = document.getElementById('moviePlayer');
  const fileInput   = document.getElementById('fileInput');
  const filePrompt  = document.getElementById('filePrompt');

  const playPauseBtn = document.getElementById('playPauseBtn');
  const skipBtn      = document.getElementById('skipBtn');
  const reverseBtn   = document.getElementById('reverseBtn');

  const micBtn      = document.getElementById('micBtn');
  const audioContainer = document.getElementById('audio-container');

  const initialsContainer = document.getElementById('userInitials');

  if (!room) { window.location.href = 'index.html'; return; }

  socket.emit('join_movie_room', { room, userName });
  // announce we are ready to build PCs even without mic
  socket.emit('ready-for-voice', { room });

  // --- helper for initials color
  function nameToColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const hue = ((hash % 360) + 360) % 360;
    return `hsl(${hue}, 70%, 60%)`;
  }

  // --- unblock all <audio> tags after any click gesture
  function playAllBlockedAudio() {
    audioContainer.querySelectorAll('audio').forEach(a => {
      a.play().catch(() => {});
    });
  }

  // --------------------
  // WebRTC helpers
  // --------------------
  function getOrCreatePC(socketId) {
    let pc = peerConnections[socketId];
    if (pc) return pc;

    pc = new RTCPeerConnection(configuration);
    peerConnections[socketId] = pc;

    // attach any current local (mic) tracks
    if (localStream) {
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }

    // attach movie tracks if we are the broadcaster
    if (isBroadcaster && movieStream) {
      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('ice-candidate', { room, to: socketId, candidate: e.candidate });
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];

      if (event.track.kind === 'video') {
        filePrompt.style.display = 'none';
        videoPlayer.srcObject = stream;
        videoPlayer.muted = false;

        videoPlayer.play().catch(() => {
          const btn = document.createElement('button');
          btn.textContent = '🔊 Tap to enable sound';
          btn.style = `
            position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
            background: #7c5cff; color: white; border: none;
            padding: 12px 20px; border-radius: 10px; cursor: pointer; font-size: 16px;
            box-shadow: 0 8px 20px #0004;
          `;
          document.body.appendChild(btn);
          btn.onclick = () => {
            videoPlayer.play().then(() => btn.remove());
            playAllBlockedAudio();
          };
        });

        // enable buttons for both sides (you may disable for guest if you prefer)
        playPauseBtn.disabled = false;
        skipBtn.disabled      = false;
        reverseBtn.disabled   = false;
      }

      if (event.track.kind === 'audio') {
        // mic-only stream from a peer (separate from video)
        if (stream.getVideoTracks().length === 0) {
          let audio = document.getElementById(`audio-${socketId}`);
          if (!audio) {
            audio = document.createElement('audio');
            audio.id = `audio-${socketId}`;
            audio.autoplay = true;
            audio.controls = false;
            audioContainer.appendChild(audio);
          }
          audio.srcObject = stream;
          // don't call play() here; let the user gesture (file or mic click) unlock it
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

  // --------------------
  // Broadcaster: choose a local file
  // --------------------
  fileInput.addEventListener('change', async () => {
    isBroadcaster = true;
    const file = fileInput.files[0];
    if (!file) return;

    videoPlayer.src = URL.createObjectURL(file);
    videoPlayer.muted = true; // mute on host to avoid echo
    await videoPlayer.play().catch(() => {});
    filePrompt.style.display = 'none';

    // this user gesture lets us unlock any pending audio elements
    playAllBlockedAudio();

    movieStream = videoPlayer.captureStream();

    // attach/replace movie tracks on all PCs, keep local mic track if present
    for (const id of Object.keys(peerConnections)) {
      const pc = getOrCreatePC(id);
      const localMicTrack = localStream ? localStream.getAudioTracks()[0] : null;

      // remove old video senders
      pc.getSenders()
        .filter(s => s.track && s.track.kind === 'video')
        .forEach(s => pc.removeTrack(s));

      // remove any non-mic audio sender (old movie audio) so we can re-add fresh
      pc.getSenders()
        .filter(s => s.track && s.track.kind === 'audio' && s.track !== localMicTrack)
        .forEach(s => pc.removeTrack(s));

      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    }

    await renegotiateAll();
  });

  // --------------------
  // Video controls (sync)
  // --------------------
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

  socket.on('video_play', () => {
    if (videoPlayer.paused) videoPlayer.play().catch(()=>{});
  });
  socket.on('video_pause', () => {
    if (!videoPlayer.paused) videoPlayer.pause();
  });
  socket.on('video_seek', (time) => {
    if (Math.abs(videoPlayer.currentTime - time) > 1) {
      videoPlayer.currentTime = time;
    }
  });

  // --------------------
  // Mic toggle
  // --------------------
  let micOn = false;
  micBtn.addEventListener('click', async () => {
    micOn = !micOn;
    const icon = micBtn.querySelector('i');

    if (micOn && !localStream) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true }
        });

        for (const id of Object.keys(peerConnections)) {
          const pc = getOrCreatePC(id);
          localStream.getAudioTracks().forEach(t => pc.addTrack(t, localStream));
        }
        await renegotiateAll();

        // user gesture → unlock any pending <audio> elements
        playAllBlockedAudio();
      } catch (e) {
        console.error('Mic blocked:', e);
        micOn = false;
      }
    }

    if (localStream) {
      localStream.getTracks().forEach(t => t.enabled = micOn);
    }
    icon.className = micOn ? 'fas fa-microphone' : 'fas fa-microphone-slash';
  });

  // --------------------
  // Signaling
  // --------------------
  socket.on('existing-voice-users', (ids) => {
    ids.forEach(id => { if (id !== socket.id) sendOffer(id); });
  });

  socket.on('user-joined-voice', ({ socketId }) => {
    if (socketId !== socket.id) sendOffer(socketId);
  });

  // accept offers even without mic
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

  // initials bar
  socket.on('update_users', (userNames) => {
    if (!initialsContainer) return;
    initialsContainer.innerHTML = '';
    userNames.forEach(name => {
      const d = document.createElement('div');
      d.className = 'initial-circle';
      d.textContent = (name[0] || '?').toUpperCase();
      d.title = name;
      d.style.backgroundColor = nameToColor(name);
      initialsContainer.appendChild(d);
    });
  });
});
