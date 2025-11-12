document.addEventListener('DOMContentLoaded', () => {

  const socket = io('https://twin-canvas.onrender.com');

  let movieStream;
  let localStream;
  let isBroadcaster = false; // ✅ This is critical
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

  // timeline UI elements
  const timeline = document.getElementById('timeline');
  const currentTimeLabel = document.getElementById('currentTime');
  const durationLabel = document.getElementById('duration');
  const videoContainer = document.getElementById('videoContainer');
  const timelineContainer = document.getElementById('timelineContainer');
  const fullscreenBtn = document.getElementById('fullscreenBtn');

  if (!room) { window.location.href = 'index.html'; return; }

  socket.emit('join_movie_room', { room, userName });

  // --- helper functions (unchanged) ---
  function nameToColor(name) {
    if (!name) return '#888';
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 70%, 60%)`;
  }

  function playAllBlockedAudio() {
    audioContainer.querySelectorAll('audio').forEach(a => a.play().catch(()=>{}));
  }

  function getOrCreatePC(socketId) {
    let pc = peerConnections[socketId];
    if (pc) return pc;

    pc = new RTCPeerConnection(configuration);
    peerConnections[socketId] = pc;

    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    if (isBroadcaster && movieStream) movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));

    pc.onicecandidate = e => {
      if (e.candidate) socket.emit('ice-candidate', { room, to: socketId, candidate: e.candidate });
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;

      // movie stream
      if (stream.getVideoTracks().length > 0) {
        filePrompt.style.display = 'none';
        videoPlayer.srcObject = stream;
        videoPlayer.muted = false;
        videoPlayer.play().catch(()=>{}); 
        playPauseBtn.disabled = false;
        skipBtn.disabled = false;
        reverseBtn.disabled = false;
        
        // Receiver timeline is disabled until duration arrives
        if (timeline) timeline.disabled = true;

      } else {
        // mic stream
        let audio = document.getElementById(`audio-${socketId}`);
        if (!audio) {
          audio = document.createElement('audio');
          audio.id = `audio-${socketId}`;
          audio.autoplay = true;
          audio.controls = false;
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
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('voice-offer', { room, to, offer: pc.localDescription });
    } catch (e) {
      console.warn('sendOffer error', e);
    }
  }

  async function renegotiateAll() {
    for (const id of Object.keys(peerConnections)) {
      await sendOffer(id);
    }
  }

  // ---------------- File upload / capture (unchanged) ----------------
  fileInput.addEventListener('change', async () => {
    isBroadcaster = true; // You are the broadcaster
    const file = fileInput.files[0];
    if (!file) return;

    videoPlayer.src = URL.createObjectURL(file);
    videoPlayer.muted = false;
    await videoPlayer.play().catch(()=>{});
    filePrompt.style.display = 'none';
    playAllBlockedAudio();

    movieStream = (typeof videoPlayer.captureStream === 'function')
      ? videoPlayer.captureStream()
      : (typeof videoPlayer.mozCaptureStream === 'function') ? videoPlayer.mozCaptureStream() : null;

    if (!movieStream) {
      alert('Browser does not support captureStream() - use Chrome/Edge.');
      return;
    }

    if (Object.keys(peerConnections).length === 0) {
      socket.emit('request_movie_users', { room });
    } else {
      for (const id of Object.keys(peerConnections)) {
        const pc = getOrCreatePC(id);
        pc.getSenders().filter(s => s.track && s.track.kind === 'video').forEach(s => pc.removeTrack(s));
        movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
      }
      await renegotiateAll();
    }
  });

  // ---------------- Playback sync & controls (MODIFIED) ----------------
  function setPlayIcon(isPlaying) {
    playPauseBtn.innerHTML = isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
  }

  // ✅ THIS IS THE ONLY CHANGED FUNCTION
  playPauseBtn.addEventListener('click', () => {
    // Check the button's ICON, not the video's 'paused' state
    const icon = playPauseBtn.querySelector('i');
    
    if (icon.classList.contains('fa-play')) {
      // If it shows "play", we must want to play
      socket.emit('video_play', { room });
    } else {
      // If it shows "pause", we must want to pause
      socket.emit('video_pause', { room });
    }
  });

  skipBtn.addEventListener('click', () => {
    const maxDur = parseFloat(timeline.max) || Infinity;
    const current = parseFloat(timeline.value) || 0;
    const newTime = Math.min(current + 10, maxDur);
    // EVERYONE just emits the event
    socket.emit('video_seek', { room, time: newTime });
  });

  reverseBtn.addEventListener('click', () => {
    const current = parseFloat(timeline.value) || 0;
    const newTime = Math.max(current - 10, 0);
    // EVERYONE just emits the event
    socket.emit('video_seek', { room, time: newTime });
  });

  // --- Receiving Sync Events ---
  
  socket.on('video_play', () => {
    videoPlayer.play().catch(()=>{});
    setPlayIcon(true);
  });
  
  socket.on('video_pause', () => {
    videoPlayer.pause();
    setPlayIcon(false);
  });
  
  socket.on('video_seek', (time) => {
    // ONLY broadcaster actually changes the video time
    if (isBroadcaster) {
      videoPlayer.currentTime = time;
    }
    // Everyone updates their UI
    updateTimelineUI(time);
  });

  // ---------------- Timeline logic (MODIFIED) ----------------
  function formatTime(t) {
    if (!t || isNaN(t)) return '00:00';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  }

  function updateTimelineUI(time) {
    if (!timeline) return;
    timeline.value = time;
    const max = parseFloat(timeline.max) || 0;
    const percent = (max > 0) ? (time / max) * 100 : 0;
    timeline.style.setProperty('--progress', `${percent}%`);
    if (currentTimeLabel) currentTimeLabel.textContent = formatTime(time);
  }

  videoPlayer.addEventListener('loadedmetadata', () => {
    // Only the broadcaster can read duration from the video
    if (isBroadcaster) {
      const duration = videoPlayer.duration;
      if (durationLabel && !isNaN(duration)) {
        durationLabel.textContent = formatTime(duration);
      }
      if (timeline && !isNaN(duration)) {
        timeline.max = duration;
        timeline.step = 0.1;
        timeline.disabled = false;
      }
      // ------ TELL EVERYONE THE DURATION ------
      socket.emit('video_duration', { room, duration: duration });
      
      timelineContainer.classList.add('visible');
    }
  });

  // ------ NEW: RECEIVER LISTENS FOR DURATION ------
  socket.on('video_duration', (duration) => {
    if (isBroadcaster) return; // Ignore if we sent it

    if (durationLabel && !isNaN(duration)) {
      durationLabel.textContent = formatTime(duration);
    }
    if (timeline && !isNaN(duration)) {
      timeline.max = duration;
      timeline.step = 0.1;
      timeline.disabled = false; // Enable timeline for receiver
    }
    timelineContainer.classList.add('visible');
  });


  let isUserSeeking = false;
  videoPlayer.addEventListener('timeupdate', () => {
    // ONLY the broadcaster sends time updates
    if (isBroadcaster && !isUserSeeking) {
      const time = videoPlayer.currentTime || 0;
      updateTimelineUI(time);
      // ------ SEND CURRENT TIME TO EVERYONE ------
      socket.emit('video_timeupdate', { room, time: time });
    }
  });

  // ------ NEW: RECEIVER LISTENS FOR TIME UPDATES ------
  socket.on('video_timeupdate', (time) => {
    if (isBroadcaster || isUserSeeking) return; // Ignore if we are sender or seeking
    updateTimelineUI(time);
  });


  if (timeline) {
    timeline.addEventListener('pointerdown', () => { isUserSeeking = true; });
    timeline.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value || 0);
      const max = parseFloat(timeline.max) || 0;
      const percent = (max > 0) ? (v / max) * 100 : 0;
      timeline.style.setProperty('--progress', `${percent}%`);
      if (currentTimeLabel) currentTimeLabel.textContent = formatTime(v);
    });
    
    const finishSeek = (e) => {
      const v = parseFloat(e.target.value || 0);
      // EVERYONE just emits the seek event
      socket.emit('video_seek', { room, time: v });
      
      // Update UI locally *only if* broadcaster
      if(isBroadcaster) {
        videoPlayer.currentTime = v;
        updateTimelineUI(v);
      }
      
      setTimeout(() => { isUserSeeking = false; }, 150);
    };
    timeline.addEventListener('change', finishSeek);
    timeline.addEventListener('pointerup', finishSeek);
    timeline.addEventListener('pointercancel', () => { isUserSeeking = false; });
  }

  // ---------------- Toggleable Controls & Fullscreen (unchanged) ----------------
  function toggleControls() {
    if (!timelineContainer) return;
    timelineContainer.classList.toggle('visible');
  }
  videoContainer.addEventListener('dblclick', toggleControls);
  videoPlayer.addEventListener('click', () => {
    if (timelineContainer.classList.contains('visible')) {
      timelineContainer.classList.remove('visible');
    }
  });
  timelineContainer.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  function toggleFullScreen() {
    if (!document.fullscreenElement) {
      videoContainer.requestFullscreen().catch(err => {
        alert(`Error: ${err.message} (${err.name})`);
      });
    } else {
      document.exitFullscreen();
    }
  }
  fullscreenBtn.addEventListener('click', toggleFullScreen);
  
  // ---------------- Mic logic (unchanged) ----------------
  let micOn = false;
  micBtn.addEventListener('click', async () => {
    micOn = !micOn;
    const icon = micBtn.querySelector('i');

    if (micOn && !localStream) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true }});
        socket.emit('ready-for-voice', { room });

        for (const id of Object.keys(peerConnections)) {
          const pc = getOrCreatePC(id);
          localStream.getAudioTracks().forEach(t => pc.addTrack(t, localStream));
        }
        await renegotiateAll();
        playAllBlockedAudio();

      } catch (e) {
        console.error("Mic blocked:", e);
        micOn = false;
      }
    }

    if (localStream) localStream.getTracks().forEach(t => t.enabled = micOn);
    icon.className = micOn ? 'fas fa-microphone' : 'fas fa-microphone-slash';
  });

  // ---------------- Signaling / UI logos (MODIFIED) ----------------
  socket.on('movie-users', (ids) => ids.forEach(id => sendOffer(id)));

  socket.on('update_users', (userNames) => {
    const initialsContainer = document.getElementById('userInitials');
    initialsContainer.innerHTML = '';
    userNames.forEach(name => {
      const el = document.createElement('div');
      el.className = 'initial-circle';
      el.textContent = (name ? name.charAt(0).toUpperCase() : '?');
      el.style.backgroundColor = nameToColor(name || 'Anon');
      initialsContainer.appendChild(el);
    });
  });

  socket.on('existing-voice-users', (ids) => {
    if (!localStream) return;
    ids.forEach(id => { if (id !== socket.id) sendOffer(id); });
  });

  socket.on('user-joined-voice', ({ socketId }) => {
    if (!localStream) return;
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

    // ------ FIX for InvalidStateError ------
    if (pc.signalingState === 'stable') {
      console.warn(`Ignoring 'voice-answer' from ${from}, state is 'stable'.`);
      return;
    }
    // ------ End of Fix ------

    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  });

  socket.on('ice-candidate', async ({ from, candidate }) => {
    const pc = getOrCreatePC(from);
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
  });

  socket.on('user-left-voice', (socketId) => {
    peerConnections[socketId]?.close();
    delete peerConnections[socketId];
    document.getElementById(`audio-${socketId}`)?.remove();
  });

});
