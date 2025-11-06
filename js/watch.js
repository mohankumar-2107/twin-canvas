document.addEventListener('DOMContentLoaded', () => {

  const socket = io('https://twin-canvas.onrender.com'); // your signaling server

  // We are NOT streaming. This is a Sync Player.
  // const movieStream; <-- REMOVED
  // let isBroadcaster = false; <-- REMOVED

  let localStream;        // optional mic
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
  
  // --- Timeline Elements ---
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
  
  // --- LOGO LOGIC (from draw.js) ---
  function nameToColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 60%)`;
  }
  
  // --- MIC LOGIC (from draw.js) ---
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

  // --- MIC LOGIC (from draw.js) ---
  function getOrCreatePC(socketId) {
    let pc = peerConnections[socketId];
    if (pc) return pc;
    pc = new RTCPeerConnection(configuration);
    peerConnections[socketId] = pc;
    if (localStream) {
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }
    pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('ice-candidate', { room, to: socketId, candidate: e.candidate });
    };
    pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (event.track.kind === "audio") {
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
  // --- End of Mic WebRTC Logic ---


  // --- File Select Logic (Sync Player) ---
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) {
        videoPlayer.src = URL.createObjectURL(file);
        filePrompt.style.display = 'none';
        
        // This click unblocks audio
        playAllBlockedAudio();
    }
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
    videoPlayer.currentTime = time;
  });

  // --- Timeline & Double-tap Logic ---
  function formatTime(seconds) {
      if (isNaN(seconds)) return "0:00";
      const min = Math.floor(seconds / 60);
      const sec = Math.floor(seconds % 60);
      return `${min}:${sec < 10 ? '0' : ''}${sec}`;
  }
  videoPlayer.addEventListener('loadedmetadata', () => {
      timeline.max = videoPlayer.duration;
      durationElem.textContent = formatTime(videoPlayer.duration);
  });
  videoPlayer.addEventListener('timeupdate', () => {
      if (!timeline.matches(':active')) { 
          timeline.value = videoPlayer.currentTime;
      }
      currentTimeElem.textContent = formatTime(videoPlayer.currentTime);
  });
  timeline.addEventListener('input', () => { 
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
          }, 3000); 
      }
  }
  videoContainer.addEventListener('dblclick', toggleTimeline);
  
  // This click also unblocks audio
  videoContainer.addEventListener('click', () => {
      playAllBlockedAudio();
  });
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
    if (!localStream) return; // Don't answer if mic isn't ready
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
