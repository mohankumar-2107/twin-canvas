document.addEventListener('DOMContentLoaded', () => {

  const socket = io('https://twin-canvas.onrender.com'); // your signaling server

  let movieStream;
  let localStream;           // optional mic
  let isBroadcaster = false;
  let isSyncing = false;
  const peerConnections = {}; 
  const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  const urlParams   = new URLSearchParams(window.location.search);
  const room        = urlParams.get('room');
  const userName    = localStorage.getItem('twinCanvasUserName') || 'Anonymous';

  const videoPlayer = document.getElementById('moviePlayer');
  const fileInput   = document.getElementById('fileInput');
  const filePrompt  = document.getElementById('filePrompt');

  const playPauseBtn= document.getElementById('playPauseBtn');
  const skipBtn     = document.getElementById('skipBtn');
  const reverseBtn  = document.getElementById('reverseBtn');

  const micBtn      = document.getElementById('micBtn');
  const audioContainer = document.getElementById('audio-container');

  if (!room) { window.location.href = 'index.html'; return; }

  // join + ready for WebRTC even without mic
  socket.emit('join_movie_room', { room, userName });
  socket.emit('ready-for-voice', { room });

  // -----------------------------------
  // PeerConnection helper
  // -----------------------------------
  function getOrCreatePC(socketId) {
    let pc = peerConnections[socketId];
    if (pc) return pc;

    pc = new RTCPeerConnection(configuration);
    peerConnections[socketId] = pc;

    // add mic if we already have it
    if (localStream) {
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }

    // add movie tracks to new peers
    if (isBroadcaster && movieStream) {
      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('ice-candidate', { room, to: socketId, candidate: e.candidate });
    };

    pc.ontrack = (event) => {
      // -------- VIDEO TRACK --------
      if (event.track.kind === 'video') {
        filePrompt.style.display = 'none';
        videoPlayer.srcObject = event.streams[0];
        videoPlayer.muted = false; 

        videoPlayer.play().catch(() => {
          // Browser blocked auto-play audio.
          const btn = document.createElement("button");
          btn.textContent = "🔊 Tap to enable sound";
          btn.style = `
            position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
            background: #7c5cff; color: white; border: none;
            padding: 12px 20px; border-radius: 10px; cursor: pointer; font-size: 16px;
          `;
          document.body.appendChild(btn);

          btn.onclick = () => {
            videoPlayer.play().then(() => {
              btn.remove();
            });
          };
        });

        // disable controls for guest
        playPauseBtn.disabled = true;
        skipBtn.disabled = true;
        reverseBtn.disabled = true;
      }

      // -------- AUDIO TRACK --------
      if (event.track.kind === "audio") {
        let audio = document.getElementById(`audio-${socketId}`);
        if (!audio) {
          audio = document.createElement("audio");
          audio.id = `audio-${socketId}`;
          audio.autoplay = true;
          audio.controls = false;
          audioContainer.appendChild(audio);
        }
        audio.srcObject = event.streams[0];
      }
    };

    return pc;
  }

  // -----------------------------------
  // Offer helper
  // -----------------------------------
  async function sendOffer(to) {
    const pc = getOrCreatePC(to);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('voice-offer', { room, to, offer: pc.localDescription });
  }

  // renegotiate after adding new tracks
  async function renegotiateAll() {
    for (const id of Object.keys(peerConnections)) {
      await sendOffer(id);
    }
  }

  // -----------------------------------
  // Broadcaster: choose file → stream
  // -----------------------------------
  fileInput.addEventListener('change', async () => {
    isBroadcaster = true;
    const file = fileInput.files[0];
    if (!file) return;

    videoPlayer.src = URL.createObjectURL(file);
    videoPlayer.muted = true; // mute on host to avoid echo
    await videoPlayer.play().catch(() => {});
    filePrompt.style.display = 'none';

    movieStream = videoPlayer.captureStream();

    for (const id of Object.keys(peerConnections)) {
      const pc = getOrCreatePC(id);

      // remove older video tracks
      pc.getSenders()
        .filter(s => s.track && s.track.kind === 'video')
        .forEach(s => pc.removeTrack(s));

      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    }

    await renegotiateAll();
  });

  // -----------------------------------
  // Playback sync (host controls)
  // -----------------------------------
  playPauseBtn.addEventListener('click', () => {
    if (videoPlayer.paused) videoPlayer.play();
    else videoPlayer.pause();
  });

  skipBtn.addEventListener('click', () => {
    if (!isBroadcaster) return;
    videoPlayer.currentTime += 10;
    socket.emit('video_seek', { room, time: videoPlayer.currentTime });
  });

  reverseBtn.addEventListener('click', () => {
    if (!isBroadcaster) return;
    videoPlayer.currentTime -= 10;
    socket.emit('video_seek', { room, time: videoPlayer.currentTime });
  });

  videoPlayer.addEventListener('play', () => {
    if (isSyncing) { isSyncing = false; return; }
    if (isBroadcaster) socket.emit('video_play', { room });
    playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
  });

  videoPlayer.addEventListener('pause', () => {
    if (isSyncing) { isSyncing = false; return; }
    if (isBroadcaster) socket.emit('video_pause', { room });
    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
  });

  socket.on('video_play', () => {
    isSyncing = true;
    videoPlayer.play().catch(()=>{});
    playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
  });

  socket.on('video_pause', () => {
    isSyncing = true;
    videoPlayer.pause();
    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
  });

  socket.on('video_seek', (time) => {
    isSyncing = true;
    videoPlayer.currentTime = time;
  });

  // -----------------------------------
  // Mic button (optional)
  // -----------------------------------
  let micOn = false;
  micBtn.addEventListener('click', async () => {
    micOn = !micOn;
    const icon = micBtn.querySelector('i');

    if (micOn && !localStream) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio:true });
        for (const id of Object.keys(peerConnections)) {
          const pc = getOrCreatePC(id);
          localStream.getAudioTracks().forEach(t => pc.addTrack(t, localStream));
        }
        await renegotiateAll();
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

  // -----------------------------------
  // Signaling Events
  // -----------------------------------
  socket.on('existing-voice-users', (ids) => {
    ids.forEach(id => {
      if (id !== socket.id) sendOffer(id);
    });
  });

  socket.on('user-joined-voice', ({ socketId }) => {
    if (socketId !== socket.id) sendOffer(socketId);
  });

  // IMPORTANT: Guests without mic STILL accept offer
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
