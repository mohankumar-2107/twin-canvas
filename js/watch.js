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

  // join movie room
  socket.emit('join_movie_room', { room, userName });

  // ---- Reverse-broadcast fix: when we ask who is in the room, server replies here
  socket.on("movie-users", (ids) => {
    ids.forEach(id => {
      sendMovieOffer(id); // send movie offer to each existing user
    });
  });

  function playAllBlockedAudio() {
    audioContainer.querySelectorAll('audio').forEach(audio => {
      audio.play().catch(() => {});
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

  function getOrCreatePC(socketId) {
    let pc = peerConnections[socketId];
    if (pc) return pc;

    pc = new RTCPeerConnection(configuration);
    peerConnections[socketId] = pc;

    // attach mic (if enabled)
    if (localStream) {
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }
    // attach movie (if we are the uploader)
    if (isBroadcaster && movieStream) {
      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    }

    // NOTE: we use the same signaling channel on server ('ice-candidate')
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('ice-candidate', { room, to: socketId, candidate: e.candidate });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];

      // If stream includes video → it's the movie
      if (stream.getVideoTracks().length > 0) {
        filePrompt.style.display = 'none';
        videoPlayer.srcObject = stream;
        videoPlayer.muted = false;
        videoPlayer.play().catch(() => {});
        playPauseBtn.disabled = false;
        skipBtn.disabled = false;
        reverseBtn.disabled = false;
      } else {
        // mic-only stream
        let audio = document.getElementById(`audio-${socketId}`);
        if (!audio) {
          audio = document.createElement("audio");
          audio.id = `audio-${socketId}`;
          audio.controls = false;
          audio.autoplay = true;
          audioContainer.appendChild(audio);
        }
        audio.srcObject = stream;
      }
    };

    return pc;
  }

  // ---- We separate movie offers from voice offers to avoid confusion
  async function sendMovieOffer(to) {
    const pc = getOrCreatePC(to);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // we keep using voice-offer on server for signaling (compatible with your server.js)
    socket.emit('voice-offer', { room, to, offer: pc.localDescription });
  }

  async function sendVoiceOffer(to) {
    const pc = getOrCreatePC(to);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('voice-offer', { room, to, offer: pc.localDescription });
  }

  async function renegotiateMovieWithAll() {
    const ids = Object.keys(peerConnections);
    for (const id of ids) {
      await sendMovieOffer(id);
    }
  }

  // ---- File upload: become broadcaster and share the movie
  fileInput.addEventListener('change', async () => {
    isBroadcaster = true;
    const file = fileInput.files[0];
    if (!file) return;

    videoPlayer.src = URL.createObjectURL(file);
    videoPlayer.muted = false;
    await videoPlayer.play().catch(() => {});
    filePrompt.style.display = 'none';

    playAllBlockedAudio();

    movieStream = videoPlayer.captureStream();

    // If no peers yet, ask server who is here, then send offers to them
    if (Object.keys(peerConnections).length === 0) {
      socket.emit("request_movie_users", { room });
    } else {
      // otherwise, attach fresh tracks and renegotiate with existing peers
      for (const id of Object.keys(peerConnections)) {
        const pc = getOrCreatePC(id);

        const localAudioTrack = localStream ? localStream.getAudioTracks()[0] : null;

        // remove old video senders (if any)
        pc.getSenders()
          .filter(s => s.track && s.track.kind === 'video')
          .forEach(s => pc.removeTrack(s));

        // keep our mic sender if present
        pc.getSenders()
          .filter(s => s.track && s.track.kind === 'audio' && s.track !== localAudioTrack)
          .forEach(s => pc.removeTrack(s));

        // add the new movie tracks
        movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
      }

      await renegotiateMovieWithAll();
    }
  });

  // ---- Playback controls
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
    const newTime = videoPlayer.currentTime + 10;
    videoPlayer.currentTime = newTime;
    socket.emit('video_seek', { room, time: newTime });
  });

  reverseBtn.addEventListener('click', () => {
    const newTime = videoPlayer.currentTime - 10;
    videoPlayer.currentTime = newTime;
    socket.emit('video_seek', { room, time: newTime });
  });

  // ---- Playback sync
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

  // ---- Mic logic
  let micOn = false;
  micBtn.addEventListener('click', async () => {
    micOn = !micOn;
    const icon = micBtn.querySelector('i');

    if (micOn && !localStream) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true }});
        // announce mic readiness (server will emit user-joined-voice to others)
        socket.emit('ready-for-voice', { room });

        // attach mic to all current PCs
        for (const id of Object.keys(peerConnections)) {
          const pc = getOrCreatePC(id);
          localStream.getAudioTracks().forEach(t => pc.addTrack(t, localStream));
        }
        // renegotiate mic with peers
        const ids = Object.keys(peerConnections);
        for (const id of ids) {
          await sendVoiceOffer(id);
        }
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

  // ---- Logos
  socket.on('update_users', (userNames) => {
    const initialsContainer = document.getElementById('userInitials');
    initialsContainer.innerHTML = '';
    userNames.forEach(name => {
      const initial = name.charAt(0).toUpperCase();
      const color = nameToColor(name);
      const circle = document.createElement('div');
      circle.className = 'initial-circle';
      circle.textContent = initial;
      circle.title = name;
      circle.style.backgroundColor = color;
      initialsContainer.appendChild(circle);
    });
  });

  // ---- Voice signaling (mic) — only sends if mic is on
  socket.on('existing-voice-users', (ids) => {
    if (!localStream) return; // only for mic
    ids.forEach(id => {
      if (id !== socket.id) sendVoiceOffer(id);
    });
  });

  socket.on('user-joined-voice', ({ socketId }) => {
    if (!localStream) return; // only for mic
    if (socketId !== socket.id) sendVoiceOffer(socketId);
  });

  // ---- Common signaling handlers (works for both movie & mic since we use one RTCPeerConnection per peer)
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
