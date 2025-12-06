document.addEventListener('DOMContentLoaded', function() {
    const signupForm = document.getElementById('signupForm');
    const loginForm = document.getElementById('loginForm');
    const messageDiv = document.getElementById('message');

    // Protect dashboard/food-hub pages
    if (window.location.pathname.includes('dashboard.html') || window.location.pathname.includes('food-hub.html')) {
        const user = JSON.parse(localStorage.getItem('userInfo'));
        if (!user || !user.uniqueWording) {
            window.location.href = '/';
        }
    }

    if (signupForm) {
        handleFormSubmit(signupForm, '/signup');
        setupPasswordValidation();
    }

    if (loginForm) {
        handleFormSubmit(loginForm, '/login');
    }

    function handleFormSubmit(form, endpoint) {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            if (messageDiv) messageDiv.className = '';

            const formData = new FormData(form);
            const data = Object.fromEntries(formData.entries());

            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                const result = await response.json();
                console.log('Server response:', result);
                
                if (response.ok) {
                    if (messageDiv) {
                        messageDiv.textContent = result.message;
                        messageDiv.className = 'success';
                    }
                    
                    if (result.user) {
                        localStorage.setItem('userInfo', JSON.stringify(result.user));
                        console.log('✅ User stored:', result.user);
                    }
                    
                    setTimeout(() => {
                        window.location.href = '/dashboard.html';
                    }, 1500);
                } else {
                    if (messageDiv) {
                        messageDiv.textContent = result.error || 'Something went wrong';
                        messageDiv.className = 'error';
                    }
                }
            } catch (error) {
                console.error('Network error:', error);
                if (messageDiv) {
                    messageDiv.textContent = 'Network error. Please try again.';
                    messageDiv.className = 'error';
                }
            }
        });
    }

    function setupPasswordValidation() {
        if (!signupForm) return;
        const password = signupForm.querySelector('input[name="password"]');
        const confirmPassword = signupForm.querySelector('input[name="confirmPassword"]');
        if (confirmPassword && password) {
            confirmPassword.addEventListener('input', function() {
                if (password.value !== confirmPassword.value) {
                    confirmPassword.setCustomValidity('Passwords must match');
                } else {
                    confirmPassword.setCustomValidity('');
                }
            });
        }
    }

    // Global profile setup function (for food-hub)
    window.setupProfile = async function(phone, addresses) {
        const user = JSON.parse(localStorage.getItem('userInfo'));
        const res = await fetch('/api/profile/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id, phone, addresses })
        });
        return res.json();
    };
});
