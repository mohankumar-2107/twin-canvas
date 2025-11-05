document.addEventListener('DOMContentLoaded', () => {

  const socket = io('https://twin-canvas.onrender.com'); // Your Render server URL

  let movieStream;
  let localStream;        // Mic stream
  let isBroadcaster = false;
  const peerConnections = {}; 
  const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  // --- Get Page Elements ---
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
  let isMuted = true; // Mic starts muted

  if (!room) { window.location.href = 'index.html'; return; }

  // Join the movie room
  socket.emit('join_movie_room', { room, userName });
  
  // --- Helper Functions ---
  function nameToColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 60%)`;
  }
  
  function playAllBlockedAudio() {
    audioContainer.querySelectorAll('audio').forEach(audio => {
        audio.play().catch(e => console.warn("Audio play blocked (will retry on next click)", e));
    });
  }
  
  function openFullscreen() {
      const elem = document.documentElement;
      if (elem.requestFullscreen) {
        elem.requestFullscreen();
      } else if (elem.webkitRequestFullscreen) { /* Safari */
        elem.webkitRequestFullscreen();
      } else if (elem.msRequestFullscreen) { /* IE11 */
        elem.msRequestFullscreen();
      }
  }

  // --- WebRTC Core Logic ---
  function getOrCreatePC(socketId) {
    let pc = peerConnections[socketId];
    if (pc) return pc;

    pc = new RTCPeerConnection(configuration);
    peerConnections[socketId] = pc;

    // Add local mic stream (if it exists)
    if (localStream) {
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }
    // Add local movie stream (if it exists)
    if (isBroadcaster && movieStream) {
      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('ice-candidate', { room, to: socketId, candidate: e.candidate });
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      
      if (event.track.kind === 'video') {
        // This is the movie's video track.
        filePrompt.style.display = 'none';
        videoPlayer.srcObject = stream; 
        videoPlayer.muted = false;

        videoPlayer.play().catch(() => {
          // Show the "Tap to enable sound" button
          const btn = document.createElement("button");
          btn.textContent = "🔊 Tap to enable sound & go fullscreen";
          btn.style = `
            position: fixed; bottom: 20px; right: 20px;
            background: #7c5cff; color: white; border: none;
            padding: 12px 20px; border-radius: 10px; cursor: pointer; font-size: 16px;
            z-index: 100;
          `;
          document.body.appendChild(btn);
          btn.onclick = () => { 
              videoPlayer.play().then(() => btn.remove());
              openFullscreen();
              playAllBlockedAudio(); // Try to play mic audio
          };
        });

        // Enable controls for the receiver
        playPauseBtn.disabled = false;
        skipBtn.disabled = false;
        reverseBtn.disabled = false;
      }

      if (event.track.kind === "audio") {
        // This is a mic-only stream
        if (stream.getVideoTracks().length === 0) {
            let audio = document.getElementById(`audio-${socketId}`);
            if (!audio) {
              audio = document.createElement("audio");
              audio.id = `audio-${socketId}`;
              audio.controls = false;
              audioContainer.appendChild(audio);
            }
            audio.srcObject = stream;
            audio.play().catch(e => console.warn(`Mic audio for ${socketId} blocked.`));
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

  // --- Broadcaster File Select ---
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

    // Get the movie stream (video + audio)
    movieStream = videoPlayer.captureStream(); 

    // Now that we have a movie, renegotiate with all existing peers
    await renegotiateAll();
  });

  // --- Video Controls (Work for everyone) ---
  playPauseBtn.addEventListener('click', () => {
    if (videoPlayer.paused) {
        socket.emit('video_play', { room });
    } else {
        socket.emit('video_pause', { room });
    }
  });
  skipBtn.addEventListener('click', () => {
    const newTime = videoPlayer.currentTime + 10;
    socket.emit('video_seek', { room, time: newTime });
  });
  reverseBtn.addEventListener('click', () => {
    const newTime = videoPlayer.currentTime - 10;
    socket.emit('video_seek', { room, time: newTime });
  });

  // Server is the source of truth for video state
  socket.on('video_play', () => {
    videoPlayer.play().catch(()=>{});
    playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
  });
  socket.on('video_pause', () => {
    videoPlayer.pause();
    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
  });
  socket.on('video_seek', (time) => {
    // We add a small buffer to prevent fighting over the exact millisecond
    if (Math.abs(videoPlayer.currentTime - time) > 1) {
        videoPlayer.currentTime = time;
    }
  });

  // --- MIC LOGIC (Identical to drawing room) ---
  micBtn.addEventListener('click', async () => {
    isMuted = !isMuted; 
    const icon = micBtn.querySelector('i');

    if (!isMuted && !localStream) { // If unmuting and have no stream
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: true } 
        });
        
        // This is the correct logic: signal readiness *after* getting mic
        socket.emit('ready-for-voice', { room });
        
        // This click unblocks audio
        playAllBlockedAudio();

      } catch (e) {
        console.error("Mic blocked:", e);
        isMuted = true; // Failed, so reset the state
      }
    }

    if (localStream) {
      localStream.getTracks().forEach(t => t.enabled = !isMuted);
    }
    icon.className = isMuted ? 'fas fa-microphone-slash' : 'fas fa.microphone';
  });
  // --- END OF MIC LOGIC ---

  // --- Signaling Events ---
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
