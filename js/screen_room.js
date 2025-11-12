document.addEventListener('DOMContentLoaded', () => {
    // --- Logic for Back Button ---
    const backBtn_room = document.getElementById('backBtn');
    backBtn_room.addEventListener('click', (e) => {
        e.preventDefault();
        history.back();
    });

    // --- Logic for Welcome Message ---
    const welcomeMessageElement = document.getElementById('welcomeMessage');
    const userName = localStorage.getItem('twinCanvasUserName');

    if (userName) {
        welcomeMessageElement.textContent = `Welcome ${userName}! Ready to present? ✨`;
    } else {
        window.location.href = 'name.html';
        return;
    }

    // --- Logic for Logout Button ---
    const logoutBtn = document.getElementById('logoutBtn');
    logoutBtn.addEventListener('click', (e) => {
        e.preventDefault(); 
        localStorage.removeItem('twinCanvasUserName'); 
        window.location.href = 'name.html'; 
    });

    // --- Logic for Modal and Room Creation ---
    const createRoomBtn = document.getElementById('createRoomBtn');
    const joinRoomBtn = document.getElementById('joinRoomBtn');
    const roomCodeInput = document.getElementById('roomCodeInput');
    const modal = document.getElementById('roomCodeModal');
    const roomCodeText = document.getElementById('roomCodeText');
    const copyCodeBtn = document.getElementById('copyCodeBtn');

    createRoomBtn.addEventListener('click', () => {
        const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
        roomCodeText.textContent = roomCode;
        modal.classList.remove('hidden');

        setTimeout(() => {
            // This now goes to share.html
            window.location.href = `share.html?room=${roomCode}`;
        }, 2500); 
    });

    joinRoomBtn.addEventListener('click', () => {
        const roomCode = roomCodeInput.value.trim();
        if (roomCode.length === 4 && !isNaN(roomCode)) {
            // This now goes to share.html
            window.location.href = `share.html?room=${roomCode}`;
        } else {
            alert('Please enter a valid 4-digit room code.');
        }
    });

    copyCodeBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(roomCodeText.textContent).then(() => {
            copyCodeBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyCodeBtn.textContent = 'Copy';
            }, 2000);
        });
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
        }
    });
});
