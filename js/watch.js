document.addEventListener('DOMContentLoaded', () => {

  const socket = io('https://twin-canvas.onrender.com');

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

  // ✅ FIXED: If user already has movieStream, treat as broadcaster
  socket.on("movie-users", (ids) => {
    console.log("[watch] movie-users ->", ids);
    if (!movieStream) return;  // only broadcast after selecting a video

    isBroadcaster = true;  // ✅ IMPORTANT FIX HERE
    ids.forEach(id => sendOffer(id));
  });

  function playAllBlockedAudio() {
    audioContainer.querySelectorAll('audio').forEach(audio => {
      audio.play().catch(() => {});
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
    if (movieStream) {
      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('ice-candidate', { room, to: socketId, candidate: e.candidate });
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];

      if (stream.getVideoTracks().length > 0) {
        filePrompt.style.display = 'none';
        videoPlayer.srcObject = stream;
        videoPlayer.muted = false;
        videoPlayer.play().catch(() => {});
        playPauseBtn.disabled = false;
        skipBtn.disabled = false;
        reverseBtn.disabled = false;
      } else {
        let audio = document.getElementById(`audio-${socketId}`);
        if (!audio) {
          audio = document.createElement("audio");
          audio.id = `audio-${socketId}`;
          audio.controls = false;
          audioContainer.appendChild(audio);
        }
        audio.srcObject = stream;
        audio.play().catch(() => {});
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

  // ✅ File upload — broadcaster logic
  fileInput.addEventListener('change', async () => {

    const file = fileInput.files[0];
    if (!file) return;

    isBroadcaster = true; // ✅ important
    videoPlayer.src = URL.createObjectURL(file);
    videoPlayer.muted = false;

    await videoPlayer.play().catch(() => {});
    filePrompt.style.display = 'none';
    playAllBlockedAudio();

    movieStream = videoPlayer.captureStream();

    // ✅ If no peers yet, ask server who is in room
    if (Object.keys(peerConnections).length === 0) {
      socket.emit("request_movie_users", { room });
    } else {
      // send movie to all peers
      for (const id of Object.keys(peerConnections)) {
        const pc = getOrCreatePC(id);

        const localAudioTrack = localStream ? localStream.getAudioTracks()[0] : null;
        pc.getSenders().filter(s => s.track && s.track.kind === 'video').forEach(s => pc.removeTrack(s));
        pc.getSenders()
          .filter(s => s.track && s.track.kind === 'audio' && s.track !== localAudioTrack)
          .forEach(s => pc.removeTrack(s));

        movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
      }
      await renegotiateAll();
    }
  });

  // ✅ Playback sync
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

  // ✅ Mic logic unchanged
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
        micOn = false;
      }
    }

    if (localStream) {
      localStream.getTracks().forEach(t => t.enabled = micOn);
    }

    icon.className = micOn ? 'fas fa-microphone' : 'fas fa-microphone-slash';
  });

  // ✅ Voice / logos listeners unchanged
  socket.on('update_users', (userNames) => {
    const initialsContainer = document.getElementById('userInitials');
    initialsContainer.innerHTML = '';
    userNames.forEach(name => {
      const initial = name[0].toUpperCase();
      const color = nameToColor(name);
      const circle = document.createElement('div');
      circle.className = 'initial-circle';
      circle.textContent = initial;
      circle.title = name;
      circle.style.backgroundColor = color;
      initialsContainer.appendChild(circle);
    });
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
