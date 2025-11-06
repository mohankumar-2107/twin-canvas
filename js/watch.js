document.addEventListener('DOMContentLoaded', () => {

  const socket = io('https://twin-canvas.onrender.com'); // your signaling server

  let movieStream;
  let localStream;        // optional mic
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

  console.log("[watch] join_movie_room:", room, userName);
  socket.emit('join_movie_room', { room, userName });

  // ✅ When server tells us the peers to talk to (new user joined OR we asked explicitly)
  socket.on("movie-users", (ids) => {
    console.log("[watch] movie-users ->", ids);
    // Only the current uploader (with movieStream ready) should send movie offers
    if (!isBroadcaster || !movieStream) return;
    ids.forEach(id => {
      console.log("[watch] sending movie offer to", id);
      sendOffer(id);
    });
  });

  function playAllBlockedAudio() {
    audioContainer.querySelectorAll('audio').forEach(audio => {
      audio.play().catch(() => {});
    });
  }

  function safePlay(video) {
    // Ignore AbortError caused by race between play/pause during sync
    const p = video.play();
    if (p && typeof p.catch === 'function') {
      p.catch(err => {
        if (err && err.name !== 'AbortError') {
          console.warn("video.play() blocked:", err);
        }
      });
    }
  }

  function getOrCreatePC(socketId) {
    let pc = peerConnections[socketId];
    if (pc) return pc;

    pc = new RTCPeerConnection(configuration);
    peerConnections[socketId] = pc;

    // attach mic (if we have it)
    if (localStream) {
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }
    // attach movie (if we are the uploader already)
    if (isBroadcaster && movieStream) {
      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('ice-candidate', { room, to: socketId, candidate: e.candidate });
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      console.log("[watch] ontrack from", socketId, "kinds:", stream.getTracks().map(t=>t.kind));

      if (stream.getVideoTracks().length > 0) {
        filePrompt.style.display = 'none';
        videoPlayer.srcObject = stream;
        videoPlayer.muted = false;
        safePlay(videoPlayer);

        playPauseBtn.disabled = false;
        skipBtn.disabled = false;
        reverseBtn.disabled = false;
      } else {
        let audio = document.getElementById(`audio-${socketId}`);
        if (!audio) {
          audio = document.createElement("audio");
          audio.id = `audio-${socketId}`;
          audio.controls = false;
          audio.autoplay = true;
          audioContainer.appendChild(audio);
        }
        audio.srcObject = stream;
        audio.play().catch(()=>{});
      }
    };

    return pc;
  }

  async function sendOffer(to) {
    const pc = getOrCreatePC(to);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.log("[watch] emit voice-offer to", to);
    // We use 'voice-offer' channel for both video & mic in your server
    socket.emit('voice-offer', { room, to, offer: pc.localDescription });
  }

  async function renegotiateAll() {
    const ids = Object.keys(peerConnections);
    for (const id of ids) {
      await sendOffer(id);
    }
  }

  // ✅ File upload → become broadcaster and share the movie
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    isBroadcaster = true;

    videoPlayer.src = URL.createObjectURL(file);
    videoPlayer.muted = false;
    safePlay(videoPlayer);
    filePrompt.style.display = 'none';
    playAllBlockedAudio();

    movieStream = videoPlayer.captureStream();

    const peerCount = Object.keys(peerConnections).length;
    console.log("[watch] chose file; peerCount =", peerCount);

    // If no peers yet, ask server to tell us who is in the room
    if (peerCount === 0) {
      console.log("[watch] requesting existing users for movie");
      socket.emit("request_movie_users", { room });
      return;
    }

    // Else, attach tracks & renegotiate with current peers
    for (const id of Object.keys(peerConnections)) {
      const pc = getOrCreatePC(id);
      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    }
    await renegotiateAll();
  });

  // --- Playback sync ---
  playPauseBtn.addEventListener('click', () => {
    if (videoPlayer.paused) {
      safePlay(videoPlayer);
      socket.emit('video_play', { room });
    } else {
      videoPlayer.pause();
      socket.emit('video_pause', { room });
    }
  });

  skipBtn.addEventListener('click', () => {
    const newTime = videoPlayer.currentTime + 10;
    videoPlayer.currentTime = newTime;
    socket.emit('video_seek', { room, time: newTime });
  });

  reverseBtn.addEventListener('click', () => {
    const newTime = videoPlayer.currentTime - 10;
    videoPlayer.currentTime = newTime;
    socket.emit('video_seek', { room, time: newTime });
  });

  socket.on('video_play', () => safePlay(videoPlayer));
  socket.on('video_pause', () => videoPlayer.pause());
  socket.on('video_seek', (time) => {
    if (Math.abs(videoPlayer.currentTime - time) > 1) {
      videoPlayer.currentTime = time;
    }
  });

  // --- Mic logic ---
  let micOn = false;
  micBtn.addEventListener('click', async () => {
    micOn = !micOn;
    const icon = micBtn.querySelector('i');

    if (micOn && !localStream) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true }});
        socket.emit('ready-for-voice', { room });
        playAllBlockedAudio();

        for (const id of Object.keys(peerConnections)) {
          const pc = getOrCreatePC(id);
          localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
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

  // --- Logos (unchanged) ---
  socket.on('update_users', (userNames) => {
    const initialsContainer = document.getElementById('userInitials');
    if (!initialsContainer) return;
    initialsContainer.innerHTML = '';
    userNames.forEach(name => {
      const initial = name.charAt(0).toUpperCase();
      const circle = document.createElement('div');
      circle.className = 'initial-circle';
      circle.textContent = initial;
      circle.title = name;
      initialsContainer.appendChild(circle);
    });
  });

  // --- Voice signaling (mic) ---
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

  // --- Common SDP / ICE handlers (used by both movie & mic) ---
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
