document.addEventListener('DOMContentLoaded', () => {
    const socket = io('https://twin-canvas.onrender.com'); // Your Render URL

    // --- Helper function to generate a unique color from a name ---
    function nameToColor(name) {
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        const hue = hash % 360;
        // Using HSL to get vibrant, consistent colors
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

    const colorPicker = document.getElementById('colorPicker');
    const strokeWidthSlider = document.getElementById('strokeWidth');
    const toolButtons = document.querySelectorAll('.tool');
    const clearBtn = document.getElementById('clearBtn');
    const saveBtn = document.getElementById('saveBtn');
    const undoBtn = document.getElementById('undoBtn');

    const urlParams = new URLSearchParams(window.location.search);
    const room = urlParams.get('room');
    const userName = localStorage.getItem('twinCanvasUserName') || 'Anonymous';

    if (!room) {
        window.location.href = 'index.html';
        return;
    }

    socket.emit('join_room', { room, userName });

    function draw(x, y, lastX, lastY, color, width, tool) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.globalCompositeOperation = (tool === 'eraser') ? 'destination-out' : 'source-over';
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
            document.querySelector('.tool.active').classList.remove('active');
            button.classList.add('active');
            currentTool = button.dataset.tool;
        });
    });

    clearBtn.addEventListener('click', () => {
        saveState();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        socket.emit('clear', { room });
    });

    saveBtn.addEventListener('click', () => {
        const dataURL = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = `TwinCanvas_${room}.png`;
        link.click();
    });

    function saveState() {
        if (history.length > 20) history.shift();
        history.push(canvas.toDataURL());
    }

    function undoLast() {
        if (history.length > 0) {
            const lastState = history.pop();
            const img = new Image();
            img.src = lastState;
            img.onload = () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);
            };
            socket.emit('undo', { room, state: lastState });
        }
    }
    undoBtn.addEventListener('click', undoLast);

    window.addEventListener('resize', () => {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        ctx.putImageData(imageData, 0, 0);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
    });

    // --- SOCKET.IO LISTENERS ---
    socket.on('update_users', (userNames) => {
        const initialsContainer = document.getElementById('userInitials');
        initialsContainer.innerHTML = ''; // Clear previous initials

        userNames.forEach(name => {
            const initial = name.charAt(0).toUpperCase();
            const color = nameToColor(name); // Generate the unique color

            const circle = document.createElement('div');
            circle.className = 'initial-circle';
            circle.textContent = initial;
            circle.title = name;
            circle.style.backgroundColor = color; // Set the background color dynamically

            initialsContainer.appendChild(circle);
        });
    });

    socket.on('draw', (data) => {
        draw(data.x, data.y, data.lastX, data.lastY, data.color, data.width, data.tool);
    });

    socket.on('clear', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
});
