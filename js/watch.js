document.addEventListener('DOMContentLoaded', () => {

  const socket = io('https://twin-canvas.onrender.com'); // your signaling server

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
  socket.emit('ready-for-voice', { room });
  
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

    if (localStream) {
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }
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
          const btn = document.createElement("button");
          btn.textContent = "🔊 Tap to enable sound";
          btn.style = `
            position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
            background: #7c5cff; color: white; border: none;
            padding: 12px 20px; border-radius: 10px; cursor: pointer; font-size: 16px;
          `;
          document.body.appendChild(btn);
          btn.onclick = () => { videoPlayer.play().then(() => btn.remove()); };
        });

        // We enable controls for everyone
        playPauseBtn.disabled = false;
        skipBtn.disabled = false;
        reverseBtn.disabled = false;
      }

      if (event.track.kind === "audio") {
        if (stream.getVideoTracks().length === 0) { // This is a mic-only stream
            let audio = document.getElementById(`audio-${socketId}`);
            if (!audio) {
              audio = document.createElement("audio");
              audio.id = `audio-${socketId}`;
              audio.autoplay = true; // This will be blocked by the browser
              audio.controls = false;
              audioContainer.appendChild(audio);
            }
            audio.srcObject = stream;
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

  fileInput.addEventListener('change', async () => {
    isBroadcaster = true;
    const file = fileInput.files[0];
    if (!file) return;

    videoPlayer.src = URL.createObjectURL(file);
    videoPlayer.muted = false; 
    
    await videoPlayer.play().catch(() => {});
    filePrompt.style.display = 'none';

    movieStream = videoPlayer.captureStream(); 

    for (const id of Object.keys(peerConnections)) {
      const pc = getOrCreatePC(id);
      pc.getSenders().filter(s => s.track && s.track.kind === 'video').forEach(s => pc.removeTrack(s));
      pc.getSenders().filter(s => s.track && s.track.kind === 'audio' && s.track !== localStream?.getAudioTracks()[0]).forEach(s => pc.removeTrack(s));
      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    }
    await renegotiateAll();
  });

  // -----------------------------------
  // Playback sync - LAG FIX (Optimistic UI)
  // -----------------------------------
  playPauseBtn.addEventListener('click', () => {
    if (videoPlayer.paused) {
        videoPlayer.play(); // Play locally first
        socket.emit('video_play', { room }); // Then tell others
    } else {
        videoPlayer.pause(); // Pause locally first
        socket.emit('video_pause', { room }); // Then tell others
    }
  });

  skipBtn.addEventListener('click', () => {
    const newTime = videoPlayer.currentTime + 10;
    videoPlayer.currentTime = newTime; // Seek locally first
    socket.emit('video_seek', { room, time: newTime }); // Then tell others
  });

  reverseBtn.addEventListener('click', () => {
    const newTime = videoPlayer.currentTime - 10;
    videoPlayer.currentTime = newTime; // Seek locally first
    socket.emit('video_seek', { room, time: newTime }); // Then tell others
  });

  // These listeners just update the icon
  videoPlayer.addEventListener('play', () => {
    playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
  });
  videoPlayer.addEventListener('pause', () => {
    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
  });

  // Socket listeners ONLY update the player if it's out of sync
  socket.on('video_play', () => {
    if (videoPlayer.paused) videoPlayer.play().catch(()=>{});
  });
  socket.on('video_pause', () => {
    if (!videoPlayer.paused) videoPlayer.pause();
  });
  socket.on('video_seek', (time) => {
    // We add a small buffer to prevent fighting over the exact millisecond
    if (Math.abs(videoPlayer.currentTime - time) > 1) {
        videoPlayer.currentTime = time;
    }
  });
  // --- END OF LAG FIX ---

  // -----------------------------------
  // Mic button - AUDIO FIX
  // -----------------------------------
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

        // --- NEW AUDIO FIX ---
        // After getting user permission, try to play all waiting mic audio
        audioContainer.querySelectorAll('audio').forEach(audio => {
            audio.play().catch(e => console.warn("Could not play friend's audio yet", e));
        });
        // --- END OF FIX ---

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
