document.addEventListener('DOMContentLoaded', () => {
    const socket = io('https://twin-canvas.onrender.com'); // Your Render URL
    
    // Get URL params
    const urlParams = new URLSearchParams(window.location.search);
    const room = urlParams.get('room');
    const userName = localStorage.getItem('twinCanvasUserName') || 'Anonymous';

    // Get page elements
    const videoPlayer = document.getElementById('moviePlayer');
    const fileInput = document.getElementById('fileInput');
    const filePrompt = document.getElementById('filePrompt');
    const playPauseBtn = document.getElementById('playPauseBtn');
    const skipBtn = document.getElementById('skipBtn');
    const reverseBtn = document.getElementById('reverseBtn');
    
    let isSyncing = false; // Flag to prevent video event loops

    if (!room) { window.location.href = 'index.html'; return; }
    
    // Use a NEW event to join the movie room
    socket.emit('join_movie_room', { room, userName });

    // --- Video Sync Logic ---
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (file) {
            videoPlayer.src = URL.createObjectURL(file);
            filePrompt.style.display = 'none';
        }
    });

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
        videoPlayer.currentTime += 10;
        socket.emit('video_seek', { room, time: videoPlayer.currentTime });
    });

    reverseBtn.addEventListener('click', () => {
        videoPlayer.currentTime -= 10;
        socket.emit('video_seek', { room, time: videoPlayer.currentTime });
    });

    // Listen for sync events from server
    socket.on('video_play', () => {
        isSyncing = true;
        videoPlayer.play();
        playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
    });
    
    socket.on('video_pause', () => {
        isSyncing = true;
        videoPlayer.pause();
        playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
    });

    socket.on('video_seek', (time) => {
        isSyncing = true;
        videoPlayer.currentTime = time;
    });
    
    // Prevent event loops
    videoPlayer.addEventListener('play', () => {
        if (isSyncing) { isSyncing = false; return; }
        socket.emit('video_play', { room });
        playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
    });

    videoPlayer.addEventListener('pause', () => {
        if (isSyncing) { isSyncing = false; return; }
        socket.emit('video_pause', { room });
        playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
    });

    // --- Voice Chat Logic (COPIED from draw.js) ---
    const micBtn = document.getElementById('micBtn');
    const audioContainer = document.getElementById('audio-container');
    let localStream;
    let peerConnections = {};
    let isMuted = true;
    const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

    micBtn.addEventListener('click', async () => {
        isMuted = !isMuted;
        const micIcon = micBtn.querySelector('i');
        if (!localStream) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                socket.emit('ready-for-voice', { room });
            } catch (error) { console.error("Mic access error.", error); isMuted = true; return; }
        }
        localStream.getTracks().forEach(track => track.enabled = !isMuted);
        micIcon.className = isMuted ? 'fas fa-microphone-slash' : 'fas fa-microphone';
    });

    // All the WebRTC socket listeners (update_users, createPeerConnection, etc.)
    // are COPIED AND PASTED from your js/draw.js file here.
    // They are room-based, so they will work perfectly.
    // ... (Paste your full WebRTC logic here) ...
});
