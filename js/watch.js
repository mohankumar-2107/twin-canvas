document.addEventListener('DOMContentLoaded', () => {
  const socket = io('https://twin-canvas.onrender.com'); // your signaling server

  let movieStream;
  let localStream;           // user mic (optional)
  let isBroadcaster = false; // true only on the file chooser side
  let isSyncing = false;
  const peerConnections = {}; // socketId -> RTCPeerConnection
  const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  // --- simple color for initials ---
  function nameToColor(name) {
    let hash = 0; for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const hue = ((hash % 360) + 360) % 360;
    return `hsl(${hue},70%,60%)`;
  }

  // --- room / UI refs ---
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

  // --- join movie room and immediately signal we can receive media (even w/o mic) ---
  socket.emit('join_movie_room', { room, userName });
  socket.emit('ready-for-voice', { room }); // <-- key change: announce presence so host creates a PC

  // -------------------------
  // WebRTC helpers
  // -------------------------
  const getOrCreatePC = (socketId) => {
    let pc = peerConnections[socketId];
    if (pc) return pc;

    pc = new RTCPeerConnection(configuration);
    peerConnections[socketId] = pc;

    // Add our current tracks (mic if we already have it)
    if (localStream) {
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }
    // If we are the broadcaster and already have a movie stream, add its tracks
    if (isBroadcaster && movieStream) {
      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('ice-candidate', { room, to: socketId, candidate: e.candidate });
    };

    pc.ontrack = (event) => {
      if (event.track.kind === 'video') {
        filePrompt.style.display = 'none';
        videoPlayer.srcObject = event.streams[0];
        // autoplay with sound may be blocked on some browsers until user gesture:
        videoPlayer.muted = false;
        videoPlayer.play().catch(() => {/* user will need to click once */});
        playPauseBtn.disabled = true;
        skipBtn.disabled = true;
        reverseBtn.disabled = true;
      } else if (event.track.kind === 'audio') {
        // If audio is not part of the same stream as video, attach it to its own <audio>
        if (event.streams[0].getVideoTracks().length === 0) {
          let audio = document.getElementById(`audio-${socketId}`);
          if (!audio) {
            audio = document.createElement('audio');
            audio.id = `audio-${socketId}`;
            audio.autoplay = true;
            audioContainer.appendChild(audio);
          }
          audio.srcObject = event.streams[0];
        } else {
          // audio comes via the same MediaStream as video; video element will play it
        }
      }
    };

    return pc;
  };

  const createAndSendOffer = async (toId) => {
    const pc = getOrCreatePC(toId);
    const offer = await pc.createOffer({ iceRestart: false });
    await pc.setLocalDescription(offer);
    socket.emit('voice-offer', { room, to: toId, offer: pc.localDescription });
  };

  const renegotiateAll = async () => {
    for (const id of Object.keys(peerConnections)) {
      await createAndSendOffer(id);
    }
  };

  // -------------------------
  // Broadcaster: choose local file -> captureStream -> add tracks -> renegotiate
  // -------------------------
  fileInput.addEventListener('change', async () => {
    isBroadcaster = true;
    const file = fileInput.files[0];
    if (!file) return;

    videoPlayer.src = URL.createObjectURL(file);
    videoPlayer.muted = true;      // avoid echo on the host
    await videoPlayer.play().catch(() => {});
    filePrompt.style.display = 'none';

    movieStream = videoPlayer.captureStream();
    // Add (or replace) movie tracks on all PCs
    for (const id of Object.keys(peerConnections)) {
      const pc = getOrCreatePC(id);
      // remove previous video tracks from us (if any)
      pc.getSenders()
        .filter(s => s.track && s.track.kind === 'video')
        .forEach(s => pc.removeTrack(s));
      movieStream.getVideoTracks().forEach(t => pc.addTrack(t, movieStream));
      // also add audio from movie if present
      movieStream.getAudioTracks().forEach(t => {
        // avoid duplicating same track
        if (!pc.getSenders().some(s => s.track && s.track.id === t.id)) pc.addTrack(t, movieStream);
      });
    }
    await renegotiateAll();
  });

  // -------------------------
  // Video control sync (host authoritative)
  // -------------------------
  playPauseBtn.addEventListener('click', () => {
    if (videoPlayer.paused) videoPlayer.play(); else videoPlayer.pause();
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

  socket.on('video_play', () => { isSyncing = true; videoPlayer.play().catch(()=>{}); playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>'; });
  socket.on('video_pause',() => { isSyncing = true; videoPlayer.pause();                   playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';  });
  socket.on('video_seek', t => { isSyncing = true; videoPlayer.currentTime = t; });

  // -------------------------
  // Voice button: optional mic, add track later + renegotiate
  // -------------------------
  let micEnabled = false;
  micBtn.addEventListener('click', async () => {
    micEnabled = !micEnabled;
    const icon = micBtn.querySelector('i');

    if (micEnabled && !localStream) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Add mic track to every PC and renegotiate
        for (const id of Object.keys(peerConnections)) {
          const pc = getOrCreatePC(id);
          localStream.getAudioTracks().forEach(t => pc.addTrack(t, localStream));
        }
        await renegotiateAll();
      } catch (e) {
        console.error('Mic access error:', e);
        micEnabled = false;
      }
    } else if (localStream) {
      // Toggle track enabled
      localStream.getTracks().forEach(t => t.enabled = micEnabled);
    }

    icon.className = micEnabled ? 'fas fa-microphone' : 'fas fa-microphone-slash';
  });

  // -------------------------
  // Signaling: build PCs for ALL peers, not only mic users
  // -------------------------
  socket.on('existing-voice-users', (userIds) => {
    // We asked for ready-for-voice on join, so host/peers will create PCs.
    userIds.forEach(async (id) => {
      if (id === socket.id) return;
      await createAndSendOffer(id);
    });
  });

  socket.on('user-joined-voice', async ({ socketId }) => {
    if (socketId === socket.id) return;
    await createAndSendOffer(socketId);
  });

  // IMPORTANT FIX: never require localStream to handle offers (so viewers without mic still get video)
  socket.on('voice-offer', async ({ from, offer }) => {
    const pc = getOrCreatePC(from);                  // ensure a PC exists
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

  // --- initials bubble bar ---
  socket.on('update_users', (userNames) => {
    const wrap = document.getElementById('userInitials');
    if (!wrap) return;
    wrap.innerHTML = '';
    userNames.forEach(n => {
      const d = document.createElement('div');
      d.className = 'initial-circle';
      d.textContent = (n[0] || '?').toUpperCase();
      d.title = n;
      d.style.backgroundColor = nameToColor(n);
      wrap.appendChild(d);
    });
  });
});
