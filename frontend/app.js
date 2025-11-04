const API_URL = 'http://localhost:3000/api';

// Upload Form Handler
document.getElementById('uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const fileInput = document.getElementById('documentFile');
    const uploadBtn = document.getElementById('uploadBtn');
    const loading = document.getElementById('uploadLoading');
    const result = document.getElementById('uploadResult');
    
    if (!fileInput.files[0]) {
        showResult(result, 'Please select a file', 'error');
        return;
    }
    
    const formData = new FormData();
    formData.append('document', fileInput.files[0]);
    
    uploadBtn.disabled = true;
    loading.style.display = 'block';
    result.style.display = 'none';
    
    try {
        const response = await fetch(`${API_URL}/upload`, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            showResult(result, `
                <div class="result-item"><strong>✓ Success!</strong> ${data.message}</div>
                <div class="result-item"><strong>Certificate Number:</strong> ${data.certificateNumber}</div>
                <div class="result-item"><strong>Document Hash:</strong> ${data.documentHash}</div>
                <div class="result-item"><strong>File Name:</strong> ${data.fileName}</div>
                <div class="result-item"><strong>Transaction Hash:</strong> ${data.txHash}</div>
            `, 'success');
            
            // Clear file input
            fileInput.value = '';
        } else {
            showResult(result, `Error: ${data.error || 'Upload failed'}`, 'error');
        }
    } catch (error) {
        showResult(result, `Error: ${error.message}`, 'error');
    } finally {
        uploadBtn.disabled = false;
        loading.style.display = 'none';
    }
});

// Verify Form Handler
document.getElementById('verifyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const certNumber = document.getElementById('certNumber').value.trim();
    const docHash = document.getElementById('docHash').value.trim();
    const verifyBtn = document.getElementById('verifyBtn');
    const loading = document.getElementById('verifyLoading');
    const result = document.getElementById('verifyResult');
    
    verifyBtn.disabled = true;
    loading.style.display = 'block';
    result.style.display = 'none';
    
    try {
        const response = await fetch(`${API_URL}/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                certificateNumber: certNumber,
                documentHash: docHash
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            const resultClass = data.isValid ? 'success' : 'error';
            const icon = data.isValid ? '✓' : '✗';
            showResult(result, `
                <div class="result-item"><strong>${icon} ${data.message}</strong></div>
                <div class="result-item"><strong>Certificate Number:</strong> ${data.certificateNumber}</div>
                <div class="result-item"><strong>Registered Hash:</strong> ${data.registeredHash}</div>
                <div class="result-item"><strong>Provided Hash:</strong> ${data.providedHash}</div>
                <div class="result-item"><strong>Registration Date:</strong> ${new Date(data.timestamp * 1000).toLocaleString()}</div>
            `, resultClass);
        } else {
            showResult(result, `Error: ${data.error || 'Verification failed'}`, 'error');
        }
    } catch (error) {
        showResult(result, `Error: ${error.message}`, 'error');
    } finally {
        verifyBtn.disabled = false;
        loading.style.display = 'none';
    }
});

function showResult(element, message, type) {
    element.innerHTML = message;
    element.className = `result ${type}`;
    element.style.display = 'block';
}