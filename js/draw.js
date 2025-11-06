document.addEventListener('DOMContentLoaded', () => {
    const socket = io('https://twin-canvas.onrender.com'); // Your Render URL

    function nameToColor(name) {
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        const hue = hash % 360;
        return `hsl(${hue}, 70%, 60%)`;
    }

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let currentTool = 'pen';
    let history = [];
    let direction = true;

    const colorPicker = document.getElementById('colorPicker');
    const strokeWidthSlider = document.getElementById('strokeWidth');
    const toolButtons = document.querySelectorAll('.tool');
    const clearBtn = document.getElementById('clearBtn');
    const saveBtn = document.getElementById('saveBtn');
    const undoBtn = document.getElementById('undoBtn');

    const urlParams = new URLSearchParams(window.location.search);
    const room = urlParams.get('room');
    const userName = localStorage.getItem('twinCanvasUserName') || 'Anonymous';

    if (!room) { window.location.href = 'index.html'; return; }

    socket.emit('join_room', { room, userName });

    // --- ADDED VOICE CHAT LOGIC ---
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
    // --- END OF VOICE CHAT LOGIC ---

    function draw(x, y, lastX, lastY, color, width, tool) {
        // This is your original, working draw function
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.globalCompositeOperation = (tool === 'eraser') ? 'destination-out' : 'source-over';
        if (tool === 'brush') {
            ctx.globalAlpha = 0.3;
            if (ctx.lineWidth > 40 || ctx.lineWidth < 10) { direction = !direction; }
            ctx.lineWidth += (direction ? 0.5 : -0.5);
        } else {
            ctx.globalAlpha = 1.0;
        }
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.stroke();
    }

    function handleStart(e) {
        isDrawing = true;
        const { x, y } = getCoordinates(e);
        [lastX, lastY] = [x, y];
        saveState();
    }

    function handleMove(e) {
        if (!isDrawing) return;
        const { x, y } = getCoordinates(e);
        const drawData = {
            room, x, y, lastX, lastY,
            color: colorPicker.value,
            width: strokeWidthSlider.value,
            tool: currentTool
        };
        draw(x, y, lastX, lastY, drawData.color, drawData.width, drawData.tool);
        socket.emit('draw', drawData);
        [lastX, lastY] = [x, y];
    }

    function handleEnd() { isDrawing = false; ctx.beginPath(); }

    function getCoordinates(e) {
        if (e.touches && e.touches.length > 0) {
            return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
        return { x: e.clientX, y: e.clientY };
    }
    
    canvas.addEventListener('mousedown', handleStart);
    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('mouseup', handleEnd);
    canvas.addEventListener('mouseleave', handleEnd);
    canvas.addEventListener('touchstart', handleStart);
    canvas.addEventListener('touchmove', handleMove);
    canvas.addEventListener('touchend', handleEnd);

    toolButtons.forEach(button => {
        button.addEventListener('click', () => {
            document.querySelector('.tool.active')?.classList.remove('active');
            button.classList.add('active');
            currentTool = button.dataset.tool;
        });
    });

    clearBtn.addEventListener('click', () => { saveState(); ctx.clearRect(0, 0, canvas.width, canvas.height); socket.emit('clear', { room }); });
    saveBtn.addEventListener('click', () => {
        const dataURL = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = `TwinCanvas_${room}.png`;
        link.click();
    });
    function saveState() { if (history.length > 20) history.shift(); history.push(canvas.toDataURL()); }
    function undoLast() {
        if (history.length > 0) {
            const lastState = history.pop();
            const img = new Image();
            img.src = lastState;
            img.onload = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0); };
            socket.emit('undo', { room, state: lastState });
        }
    }
    undoBtn.addEventListener('click', undoLast);
    window.addEventListener('resize', () => { /* ... (same as before) ... */ });

    // --- SOCKET.IO LISTENERS ---
    
    // --- ADDED WORKING LOGO LOGIC ---
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
    // --- END OF LOGO LOGIC ---

    socket.on('draw', (data) => { draw(data.x, data.y, data.lastX, data.lastY, data.color, data.width, data.tool); });
    socket.on('clear', () => { ctx.clearRect(0, 0, canvas.width, canvas.height); });
    socket.on('undo', (data) => {
        const img = new Image();
        img.src = data.state;
        img.onload = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0); };
    });
    
    // --- ADDED WORKING WEBRTC LISTENERS ---
    const createPeerConnection = (socketId) => {
        const pc = new RTCPeerConnection(configuration);
        peerConnections[socketId] = pc;
        if (localStream) {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        }
        pc.onicecandidate = e => { if (e.candidate) socket.emit('ice-candidate', { room, to: socketId, candidate: e.candidate }); };
        pc.ontrack = e => {
            let audio = document.getElementById(`audio-${socketId}`);
            if (!audio) {
                audio = document.createElement('audio');
                audio.id = `audio-${socketId}`;
                audio.autoplay = true;
                audioContainer.appendChild(audio);
            }
            audio.srcObject = e.streams[0];
        };
        return pc;
    };
    socket.on('existing-voice-users', (userIds) => {
        if (!localStream) return;
        userIds.forEach(id => {
            const pc = createPeerConnection(id);
            pc.createOffer().then(offer => pc.setLocalDescription(offer))
              .then(() => socket.emit('voice-offer', { room, to: id, offer: pc.localDescription }));
        });
    });
    socket.on('user-joined-voice', (socketId) => {
        if (!localStream) return;
        const pc = createPeerConnection(socketId);
        pc.createOffer().then(offer => pc.setLocalDescription(offer))
          .then(() => socket.emit('voice-offer', { room, to: socketId, offer: pc.localDescription }));
    });
    socket.on('voice-offer', ({ from, offer }) => {
        if (!localStream) return;
        const pc = createPeerConnection(from);
        pc.setRemoteDescription(new RTCSessionDescription(offer))
          .then(() => pc.createAnswer())
          .then(answer => pc.setLocalDescription(answer))
          .then(() => socket.emit('voice-answer', { room, to: from, answer: pc.localDescription }));
    });
    socket.on('voice-answer', ({ from, answer }) => {
        peerConnections[from]?.setRemoteDescription(new RTCSessionDescription(answer));
    });
    socket.on('ice-candidate', ({ from, candidate }) => {
        peerConnections[from]?.addIceCandidate(new RTCIceCandidate(candidate));
    });
    socket.on('user-left-voice', (socketId) => {
        peerConnections[socketId]?.close();
        delete peerConnections[socketId];
        document.getElementById(`audio-${socketId}`)?.remove();
    });
    // --- END OF WEBRTC LISTENERS ---
});
