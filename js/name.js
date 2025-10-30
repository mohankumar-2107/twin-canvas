document.addEventListener('DOMContentLoaded', () => {
    const backBtn_name = document.getElementById('backBtn');
    backBtn_name.addEventListener('click', (e) => {
    e.preventDefault();
    history.back();
});
    const userNameInput = document.getElementById('userName');
    const continueBtn = document.getElementById('continueBtn');

    continueBtn.addEventListener('click', () => {
        const userName = userNameInput.value.trim();
        if (userName) {
            localStorage.setItem('twinCanvasUserName', userName);
            window.location.href = 'room.html';
        } else {
            // This adds a subtle shake animation for feedback
            userNameInput.style.animation = 'shake 0.5s ease';
            // Remove the animation after it's done to allow re-triggering
            userNameInput.addEventListener('animationend', () => {
                userNameInput.style.animation = '';
            });
        }
    });

    // Allow pressing Enter to continue
    userNameInput.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') {
            continueBtn.click();
        }
    });
});