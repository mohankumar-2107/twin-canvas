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
  
  // --- New Timeline Elements ---
  const videoContainer = document.getElementById('videoContainer');
  const timelineContainer = document.getElementById('timelineContainer');
  const timeline = document.getElementById('timeline');
  const currentTimeElem = document.getElementById('currentTime');
  const durationElem = document.getElementById('duration');
  let timelineVisible = false; // Start hidden
  let timelineTimeout;
  let isMuted = true; // Mic starts muted

  if (!room) { window.location.href = 'index.html'; return; }

  // Join the room
  socket.emit('join_movie_room', { room, userName });
  
  // --- BUG 1 FIX: REMOVED 'ready-for-voice' from here. ---

  function nameToColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = hash % 360;
    // --- SYNTAX FIX ---
    return `hsl(${hue}, 70%, 60%)`;
  }
  
  function playAllBlockedAudio() {
    audioContainer.querySelectorAll('audio').forEach(audio => {
        audio.play().catch(e => console.warn("Audio play blocked", e));
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

    // --- BUG 2: Corrected 'ontrack' logic ---
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      
      // Check if this stream has video. If yes, it's the MOVIE.
      if (stream.getVideoTracks().length > 0) {
        filePrompt.style.display = 'none';
        videoPlayer.srcObject = stream; // This stream has BOTH video and movie audio
        videoPlayer.muted = false;

        videoPlayer.play().catch(() => {
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
              playAllBlockedAudio();
          };
        });
      }

      // If the stream has NO video, it's the MIC.
      else if (stream.getVideoTracks().length === 0) { 
          // --- SYNTAX FIX ---
          let audio = document.getElementById(`audio-${socketId}`);
          if (!audio) {
            audio = document.createElement("audio");
            audio.id = `audio-${socketId}`; // --- SYNTAX FIX ---
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
    playAllBlockedAudio();

    movieStream = videoPlayer.captureStream(); 
    await renegotiateAll();
  });

  // --- Video Controls ---
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

  // Server is the ONLY source of truth for video state
  socket.on('video_play', () => {
    videoPlayer.play().catch(()=>{});
    playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
  });
  socket.on('video_pause', () => {
    videoPlayer.pause();
    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
  });
  socket.on('video_seek', (time) => {
    // Use a buffer to prevent fighting
    if (Math.abs(videoPlayer.currentTime - time) > 1) {
        videoPlayer.currentTime = time;
    }
  });

  // --- NEW: Timeline & Double-tap Logic ---
  function formatTime(seconds) {
      const min = Math.floor(seconds / 60);
      const sec = Math.floor(seconds % 60);
      return `${min}:${sec < 10 ? '0' : ''}${sec}`;
  }
  videoPlayer.addEventListener('loadedmetadata', () => {
      timeline.max = videoPlayer.duration;
      durationElem.textContent = formatTime(videoPlayer.duration);
  });
  videoPlayer.addEventListener('timeupdate', () => {
      if (!timeline.matches(':active')) { // Only update if user is not dragging
          timeline.value = videoPlayer.currentTime;
      }
      currentTimeElem.textContent = formatTime(videoPlayer.currentTime);
  });
  timeline.addEventListener('input', () => { // Send event while dragging
      socket.emit('video_seek', { room, time: timeline.value });
  });
  function toggleTimeline() {
      timelineVisible = !timelineVisible;
      timelineContainer.style.opacity = timelineVisible ? '1' : '0';
      if (timelineVisible) {
          clearTimeout(timelineTimeout);
          timelineTimeout = setTimeout(() => {
              timelineContainer.style.opacity = '0';
              timelineVisible = false;
          }, 3000); // Hide after 3 seconds
      }
  }
  videoContainer.addEventListener('dblclick', toggleTimeline);
  // --- END of Timeline Logic ---


  // --- MIC LOGIC (Copied from working drawing room) ---
  micBtn.addEventListener('click', async () => {
    isMuted = !isMuted; 
    const icon = micBtn.querySelector('i');

    if (!isMuted && !localStream) { // If unmuting and have no stream
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: true } 
        });
        
        // --- THIS IS THE FIX ---
        // This is the correct logic: signal readiness *after* getting mic
        socket.emit('ready-for-voice', { room });
        
        // This click unblocks audio
        playAllBlockedAudio();
        
        // --- ADDED ---
        // Now that we have a mic, we must renegotiate to add it
        await renegotiateAll(); 

      } catch (e) {
        console.error("Mic blocked:", e);
        isMuted = true; // Failed, so reset the state
      }
    }

    if (localStream) {
      localStream.getTracks().forEach(t => t.enabled = !isMuted);
    }
    icon.className = isMuted ? 'fas fa-microphone-slash' : 'fas fa-microphone';
  });
  // --- END OF MIC LOGIC ---


  // --- Signaling Events (Logos, Mic, etc.) ---
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
