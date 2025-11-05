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

  socket.emit('join_movie_room', { room, userName });
  
  // --- BUG 1 FIX: REMOVED the 'ready-for-voice' from here ---
  
  function nameToColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 60%)`;
  }
  
  // --- This function is to unblock audio after a user clicks ---
  function playAllBlockedAudio() {
    audioContainer.querySelectorAll('audio').forEach(audio => {
        audio.play().catch(e => console.warn("Audio play blocked", e));
    });
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

    // --- BUG 2 FIX: Corrected 'ontrack' logic ---
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      
      // Check if this stream has video. If yes, it's the MOVIE.
      if (stream.getVideoTracks().length > 0) {
        filePrompt.style.display = 'none';
        videoPlayer.srcObject = stream; // This stream has BOTH video and movie audio
        videoPlayer.muted = false;

        videoPlayer.play().catch(() => {
          const btn = document.createElement("button");
          btn.textContent = "🔊 Tap to enable sound";
          btn.style = `... (same style as before) ...`;
          document.body.appendChild(btn);
          btn.onclick = () => { 
              videoPlayer.play().then(() => btn.remove());
              playAllBlockedAudio(); // Also unblock mic
          };
        });

        playPauseBtn.disabled = false;
        skipBtn.disabled = false;
        reverseBtn.disabled = false;
      }
      // If the stream has NO video, it's the MIC.
      else if (stream.getVideoTracks().length === 0) { 
          let audio = document.getElementById(`audio-${socketId}`);
          if (!audio) {
            audio = document.createElement("audio");
            audio.id = `audio-${socketId}`;
            audio.controls = false;
            audioContainer.appendChild(audio);
          }
          audio.srcObject = stream;
          audio.play().catch(e => {
              console.warn(`Mic audio for ${socketId} blocked. User must interact.`);
          });
      }
    };
    // --- END OF BUG 2 FIX ---
    
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
    videoPlayer.muted = false; // Unmute for broadcaster
    
    await videoPlayer.play().catch(() => {});
    filePrompt.style.display = 'none';

    // This click unblocks any waiting mic audio
    playAllBlockedAudio();

    movieStream = videoPlayer.captureStream(); 

    for (const id of Object.keys(peerConnections)) {
      const pc = getOrCreatePC(id);
      
      const localAudioTrack = localStream ? localStream.getAudioTracks()[0] : null;
      pc.getSenders().filter(s => s.track && s.track.kind === 'video').forEach(s => pc.removeTrack(s));
      pc.getSenders().filter(s => {
          return s.track && s.track.kind === 'audio' && s.track !== localAudioTrack;
      }).forEach(s => pc.removeTrack(s));
      
      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    }
    await renegotiateAll();
  });

  // --- Playback sync (Optimistic UI) ---
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

  videoPlayer.addEventListener('play', () => {
    playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
  });
  videoPlayer.addEventListener('pause', () => {
    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
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

  // --- Mic button (This is now the "Go Live" button) ---
  let micOn = false;
  micBtn.addEventListener('click', async () => {
    micOn = !micOn;
    const icon = micBtn.querySelector('i');

    if (micOn && !localStream) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: true } 
        });
        
        // --- BUG 1 FIX: Send 'ready' signal AFTER getting mic ---
        socket.emit('ready-for-voice', { room });
        
        // This click counts as user interaction, unblocking audio
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

  // --- Signaling Events (These are all correct) ---
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
    if (!localStream) return; // Don't call if mic isn't ready
    ids.forEach(id => {
      if (id !== socket.id) sendOffer(id);
    });
  });
  socket.on('user-joined-voice', ({ socketId }) => {
    if (!localStream) return; // Don't call if mic isn't ready
    if (socketId !== socket.id) sendOffer(socketId);
  });
  
  socket.on('voice-offer', async ({ from, offer }) => {
    // We MUST answer, even if our mic isn't ready
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
