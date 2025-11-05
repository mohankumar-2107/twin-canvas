// watch.js
document.addEventListener('DOMContentLoaded', () => {
  const socket = io('https://twin-canvas.onrender.com'); // your signaling server

  let movieStream;
  let localStream;                  // optional mic
  let isBroadcaster = false;
  const peerConnections = {};       // socketId => RTCPeerConnection
  const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  const urlParams = new URLSearchParams(window.location.search);
  const room = urlParams.get('room');
  const userName = localStorage.getItem('twinCanvasUserName') || 'Anonymous';

  const videoPlayer = document.getElementById('moviePlayer');
  const fileInput   = document.getElementById('fileInput');
  const filePrompt  = document.getElementById('filePrompt');

  const playPauseBtn = document.getElementById('playPauseBtn');
  const skipBtn      = document.getElementById('skipBtn');
  const reverseBtn   = document.getElementById('reverseBtn');

  const micBtn        = document.getElementById('micBtn');
  const audioContainer= document.getElementById('audio-container');
  const initialsContainer = document.getElementById('userInitials');

  if (!room) { window.location.href = 'index.html'; return; }

  // ✅ Join movie room
  socket.emit('join_movie_room', { room, userName });

  // ✅ Request all peers in room (fix 1)
  socket.emit("request-peers", { room });

  // --- Helpers ---
  function nameToColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++)
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const hue = ((hash % 360) + 360) % 360;
    return `hsl(${hue}, 70%, 60%)`;
  }

  function playAllBlockedAudio() {
    audioContainer.querySelectorAll('audio').forEach(a => {
      a.play().catch(()=>{});
    });
  }

  // --- PeerConnection ---
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
      if (e.candidate)
        socket.emit('ice-candidate', { room, to: socketId, candidate: e.candidate });
    };

    // ✅ ontrack — video + mic support
    pc.ontrack = ({ streams }) => {
      const stream = streams[0];

      // 🔥 If video exists → movie stream (video + audio)
      if (stream.getVideoTracks().length > 0) {
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
          btn.onclick = () => {
            videoPlayer.play().then(() => btn.remove());
            playAllBlockedAudio();
          };
        });

        playPauseBtn.disabled = false;
        skipBtn.disabled      = false;
        reverseBtn.disabled   = false;
      }

      // ✅ MIC stream only
      if (stream.getVideoTracks().length === 0) {
        let audio = document.getElementById(`audio-${socketId}`);
        if (!audio) {
          audio = document.createElement('audio');
          audio.id = `audio-${socketId}`;
          audio.autoplay = true;
          audio.controls = false;
          audioContainer.appendChild(audio);
        }
        audio.srcObject = stream;
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

  // ✅ When broadcaster selects file
  fileInput.addEventListener('change', async () => {
    isBroadcaster = true;
    const file = fileInput.files[0];
    if (!file) return;

    videoPlayer.src = URL.createObjectURL(file);
    videoPlayer.muted = true; // avoid echo on host
    await videoPlayer.play().catch(()=>{});
    filePrompt.style.display = 'none';

    playAllBlockedAudio(); // unblock audio

    movieStream = videoPlayer.captureStream();

    // Add tracks to all existing PCs
    for (const id of Object.keys(peerConnections)) {
      const pc = getOrCreatePC(id);
      const micTrack = localStream ? localStream.getAudioTracks()[0] : null;

      pc.getSenders()
        .filter(s => s.track && s.track.kind === 'video')
        .forEach(s => pc.removeTrack(s));

      pc.getSenders()
        .filter(s => s.track && s.track.kind === 'audio' && s.track !== micTrack)
        .forEach(s => pc.removeTrack(s));

      movieStream.getTracks().forEach(t => pc.addTrack(t, movieStream));
    }

    // ✅ Renegotiate with everyone
    await renegotiateAll();
  });

  // ✅ Playback Sync
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
    const t = videoPlayer.currentTime + 10;
    videoPlayer.currentTime = t;
    socket.emit('video_seek', { room, time: t });
  });
  reverseBtn.addEventListener('click', () => {
    const t = videoPlayer.currentTime - 10;
    videoPlayer.currentTime = t;
    socket.emit('video_seek', { room, time: t });
  });
  socket.on('video_play', () => videoPlayer.play().catch(()=>{}));
  socket.on('video_pause', () => videoPlayer.pause());
  socket.on('video_seek', (t) => {
    if (Math.abs(videoPlayer.currentTime - t) > 1)
      videoPlayer.currentTime = t;
  });

  // ✅ Mic Button
  let micOn = false;
  micBtn.addEventListener('click', async () => {
    micOn = !micOn;
    const icon = micBtn.querySelector('i');

    if (micOn && !localStream) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true }
        });

        socket.emit('ready-for-voice', { room }); // signal to build PCs
        playAllBlockedAudio();

      } catch (err) {
        console.error("Mic denied:", err);
        micOn = false;
      }
    }

    if (localStream) localStream.getTracks().forEach(t => t.enabled = micOn);
    icon.className = micOn ? 'fas fa-microphone' : 'fas fa-microphone-slash';
  });

  // ✅ Update user icons
  socket.on('update_users', (names) => {
    initialsContainer.innerHTML = '';
    names.forEach(name => {
      const div = document.createElement('div');
      div.className = 'initial-circle';
      div.textContent = name.charAt(0).toUpperCase();
      div.style.backgroundColor = nameToColor(name);
      div.title = name;
      initialsContainer.appendChild(div);
    });
  });

  // ✅ FIX: Build PCs for video even if no mic
  socket.on("peer-list", (ids) => {
    ids.forEach(id => {
      if (id !== socket.id) sendOffer(id);
    });
  });

  // ✅ Signaling
  socket.on('voice-offer', async ({ from, offer }) => {
    const pc = getOrCreatePC(from);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    socket.emit('voice-answer', { room, to: from, answer: pc.localDescription });
  });
  socket.on('voice-answer', async ({ from, answer }) => {
    const pc = getOrCreatePC(from);
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  });
  socket.on('ice-candidate', async ({ from, candidate }) => {
    const pc = getOrCreatePC(from);
    if (pc) try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch{}
  });

  socket.on('user-left-voice', (id) => {
    peerConnections[id]?.close();
    delete peerConnections[id];
    document.getElementById(`audio-${id}`)?.remove();
  });

});
