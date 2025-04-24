// static/js/script.js - Actualizado para mostrar progreso de transcripción

document.addEventListener('DOMContentLoaded', function() {
    // Elementos del DOM
    const dropArea = document.getElementById('drop-area');
    const fileInput = document.getElementById('fileInput');
    const fileInfo = document.getElementById('file-info');
    const fileName = document.getElementById('file-name');
    const fileSize = document.getElementById('file-size');
    const transcribeBtn = document.getElementById('transcribe-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.querySelector('.progress-text');
    const resultsContainer = document.getElementById('results-container');
    const transcriptText = document.getElementById('transcript-text');
    const copyBtn = document.getElementById('copy-btn');
    const downloadBtn = document.getElementById('download-btn');
    const newUploadBtn = document.getElementById('new-upload-btn');
    const errorContainer = document.getElementById('error-container');
    const errorMessage = document.getElementById('error-message');
    const errorRetryBtn = document.getElementById('error-retry-btn');

    // Variables globales
    let selectedFile = null;
    let processingAborted = false;
    let eventSource = null;
    let partialTranscriptions = {};

    // Eventos para arrastrar y soltar
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, unhighlight, false);
    });

    function highlight() {
        dropArea.classList.add('dragover');
    }

    function unhighlight() {
        dropArea.classList.remove('dragover');
    }

    // Manejar archivo soltado
    dropArea.addEventListener('drop', handleDrop, false);

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        
        if (files.length > 0) {
            handleFiles(files[0]);
        }
    }

    // Manejar selección de archivo por clic
    fileInput.addEventListener('change', function() {
        if (fileInput.files.length > 0) {
            handleFiles(fileInput.files[0]);
        }
    });

    // Procesar el archivo seleccionado
    function handleFiles(file) {
        const allowedTypes = ['audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/flac', 'audio/mp4'];
        const fileType = file.type;
        
        if (!allowedTypes.includes(fileType) && !file.name.match(/\.(wav|mp3|ogg|flac|m4a)$/i)) {
            showError('Tipo de archivo no soportado. Por favor, sube un archivo de audio en formato WAV, MP3, OGG, FLAC o M4A.');
            return;
        }
        
        // Verificar tamaño del archivo (límite 100MB)
        if (file.size > 100 * 1024 * 1024) {
            showError('El archivo es demasiado grande. El límite es de 100MB.');
            return;
        }
        
        selectedFile = file;
        
        // Mostrar información del archivo
        fileName.textContent = file.name;
        fileSize.textContent = formatFileSize(file.size);
        
        // Mostrar sección de info y ocultar la de error
        fileInfo.classList.remove('hidden');
        errorContainer.classList.add('hidden');
        
        // Actualizar mensaje según duración estimada
        const durationEstimate = estimateAudioDuration(file.size, file.type);
        if (durationEstimate > 5) {
            const processingTime = Math.ceil(durationEstimate * 0.8);
            const warningEl = document.createElement('div');
            warningEl.id = 'duration-warning';
            warningEl.style.marginTop = '10px';
            warningEl.style.color = '#e67e22';
            warningEl.textContent = `⚠️ Este archivo parece ser largo (aprox. ${Math.round(durationEstimate)} min). ` + 
                                  `El procesamiento podría tardar hasta ${processingTime} minutos.`;
            
            // Eliminar advertencia anterior si existe
            const oldWarning = document.getElementById('duration-warning');
            if (oldWarning) oldWarning.remove();
            
            fileInfo.appendChild(warningEl);
        }
    }

    // Estimar duración aproximada del audio en minutos
    function estimateAudioDuration(fileSize, fileType) {
        // Tasas de bits aproximadas por formato (kbps)
        const bitRates = {
            'audio/wav': 1411, // CD quality
            'audio/mpeg': 192,  // MP3 típico
            'audio/ogg': 160,   // OGG típico
            'audio/flac': 900,  // FLAC típico
            'audio/mp4': 192    // M4A típico
        };
        
        // Usar tasa predeterminada si no se encuentra el tipo
        const bitRate = bitRates[fileType] || 192;
        
        // Calcular duración aproximada: tamaño (bytes) / (tasa de bits * 125)
        // 125 = 1000 / 8 (conversión de kbps a bytes por segundo)
        const durationSec = fileSize / (bitRate * 125);
        return durationSec / 60; // Convertir a minutos
    }

    // Dar formato al tamaño del archivo
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Iniciar transcripción
    transcribeBtn.addEventListener('click', transcribeAudio);

    function transcribeAudio() {
        if (!selectedFile) return;
        
        // Reiniciar estado
        processingAborted = false;
        partialTranscriptions = {};
        
        // Ocultar info del archivo y mostrar progreso
        fileInfo.classList.add('hidden');
        progressContainer.classList.remove('hidden');
        
        // Crear o actualizar contenedor de información detallada
        let detailsContainer = document.getElementById('progress-details');
        if (!detailsContainer) {
            detailsContainer = document.createElement('div');
            detailsContainer.id = 'progress-details';
            detailsContainer.className = 'progress-details';
            progressContainer.appendChild(detailsContainer);
        } else {
            detailsContainer.innerHTML = '';
        }
        
        // Crear contenedor para logs de fragmentos
        let fragmentsLogContainer = document.createElement('div');
        fragmentsLogContainer.id = 'fragments-log';
        fragmentsLogContainer.className = 'fragments-log';
        fragmentsLogContainer.style.marginTop = '15px';
        fragmentsLogContainer.style.maxHeight = '150px';
        fragmentsLogContainer.style.overflowY = 'auto';
        fragmentsLogContainer.style.border = '1px solid #dadce0';
        fragmentsLogContainer.style.borderRadius = '4px';
        fragmentsLogContainer.style.padding = '10px';
        fragmentsLogContainer.style.fontSize = '0.9rem';
        detailsContainer.appendChild(fragmentsLogContainer);
        
        // Primero subir el archivo
        const formData = new FormData();
        formData.append('file', selectedFile);
        
        progressText.textContent = "Subiendo archivo...";
        progressBar.style.width = '5%';
        
        addLogMessage("Iniciando proceso de transcripción...");
        
        fetch('/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Archivo subido correctamente, iniciar streaming de transcripción
                startTranscriptionStream(data.filename);
            } else {
                showError(data.error || 'Error al subir el archivo');
                progressContainer.classList.add('hidden');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            progressContainer.classList.add('hidden');
            showError('Error de conexión. Por favor, verifica tu conexión a internet e intenta de nuevo.');
        });
    }
    
    // Iniciar streaming de progreso de transcripción
    function startTranscriptionStream(filename) {
        // Si ya existe una conexión EventSource, cerrarla
        if (eventSource) {
            eventSource.close();
        }
        
        // Crear botón para cancelar
        const cancelProcessingBtn = document.createElement('button');
        cancelProcessingBtn.id = 'cancel-processing-btn';
        cancelProcessingBtn.textContent = 'Cancelar procesamiento';
        cancelProcessingBtn.className = 'btn secondary';
        cancelProcessingBtn.style.marginTop = '15px';
        
        // Si ya existe el botón, no lo añadir de nuevo
        if (!document.getElementById('cancel-processing-btn')) {
            progressContainer.appendChild(cancelProcessingBtn);
        }
        
        // Manejar clic en cancelar
        cancelProcessingBtn.addEventListener('click', function() {
            if (eventSource) {
                eventSource.close();
                eventSource = null;
            }
            processingAborted = true;
            progressText.textContent = "Procesamiento cancelado";
            
            // Mostrar botón para volver
            const backBtn = document.createElement('button');
            backBtn.textContent = 'Volver';
            backBtn.className = 'btn primary';
            backBtn.style.marginTop = '15px';
            backBtn.addEventListener('click', resetUpload);
            
            // Reemplazar el botón de cancelar
            const oldBtn = document.getElementById('cancel-processing-btn');
            if (oldBtn) {
                oldBtn.parentNode.replaceChild(backBtn, oldBtn);
            }
        });
        
        // Crear EventSource para recibir actualizaciones en tiempo real
        eventSource = new EventSource(`/transcribe/${filename}`);
        
        eventSource.onmessage = function(event) {
            // Parsear los datos recibidos
            const data = JSON.parse(event.data);
            
            // Actualizar la interfaz según el status
            updateUI(data);
            
            // Si la transcripción ha finalizado o hay un error, cerrar la conexión
            if (data.status === 'completed' || data.status === 'error') {
                eventSource.close();
                eventSource = null;
                
                // Remover botón de cancelar
                const cancelBtn = document.getElementById('cancel-processing-btn');
                if (cancelBtn) {
                    cancelBtn.remove();
                }
            }
        };
        
        eventSource.onerror = function(error) {
            console.error('EventSource error:', error);
            eventSource.close();
            eventSource = null;
            
            addLogMessage("Error en la conexión. La transcripción puede estar incompleta.", "error");
            
            // Remover botón de cancelar
            const cancelBtn = document.getElementById('cancel-processing-btn');
            if (cancelBtn) {
                cancelBtn.remove();
            }
        };
    }
    
    // Actualizar la interfaz con información del progreso
    function updateUI(data) {
        // Actualizar barra de progreso
        if (data.progress) {
            progressBar.style.width = data.progress + '%';
        }
        
        // Manejar diferentes estados
        switch(data.status) {
            case 'converting':
            case 'converted':
            case 'loading':
            case 'splitting':
            case 'splitting_time':
                progressText.textContent = data.message;
                addLogMessage(data.message);
                break;
                
            case 'processing':
                progressText.textContent = data.message;
                addLogMessage(data.message);
                
                // Crear contenedor para fragmentos si no existe
                if (!document.getElementById('chunks-progress')) {
                    const chunksContainer = document.createElement('div');
                    chunksContainer.id = 'chunks-progress';
                    chunksContainer.style.marginTop = '10px';
                    chunksContainer.innerHTML = `<div style="font-weight: bold; margin-bottom: 5px;">Progreso de fragmentos: 0/${data.totalChunks}</div>`;
                    
                    // Contenedor para mini barras de progreso
                    const miniProgressContainer = document.createElement('div');
                    miniProgressContainer.style.display = 'flex';
                    miniProgressContainer.style.flexWrap = 'wrap';
                    miniProgressContainer.style.gap = '3px';
                    
                    // Crear mini indicadores para cada fragmento
                    for (let i = 0; i < data.totalChunks; i++) {
                        const miniChunk = document.createElement('div');
                        miniChunk.className = 'mini-chunk';
                        miniChunk.dataset.chunk = i + 1;
                        miniChunk.style.width = '15px';
                        miniChunk.style.height = '15px';
                        miniChunk.style.backgroundColor = '#dadce0';
                        miniChunk.style.borderRadius = '2px';
                        miniProgressContainer.appendChild(miniChunk);
                    }
                    
                    chunksContainer.appendChild(miniProgressContainer);
                    document.getElementById('progress-details').insertBefore(chunksContainer, document.getElementById('fragments-log'));
                }
                break;
                
            case 'transcribing':
                progressText.textContent = data.message;
                addLogMessage(data.message);
                
                // Actualizar contador de fragmentos
                const chunksProgress = document.getElementById('chunks-progress');
                if (chunksProgress) {
                    chunksProgress.querySelector('div').textContent = `Progreso de fragmentos: ${data.currentChunk}/${data.totalChunks}`;
                }
                break;
                
            case 'partial_text':
                // Guardar transcripción parcial
                partialTranscriptions[data.chunkNumber] = data.partialText;
                
                // Actualizar indicador visual de fragmento
                updateChunkIndicator(data.chunkNumber, 'success');
                
                addLogMessage(`✓ Fragmento ${data.chunkNumber} transcrito (${data.partialText.length} caracteres)`);
                break;
                
            case 'chunk_error':
                updateChunkIndicator(data.currentChunk, 'error');
                addLogMessage(data.message, 'error');
                break;
                
            case 'retry_success':
                // Guardar transcripción parcial del reintento
                partialTranscriptions[data.chunkNumber] = data.partialText;
                
                // Actualizar indicador visual de fragmento
                updateChunkIndicator(data.chunkNumber, 'retry');
                
                addLogMessage(`↻ Reintento exitoso para fragmento ${data.chunkNumber}`);
                break;
                
            case 'completed':
                progressText.textContent = "¡Transcripción completada!";
                addLogMessage("✓ Transcripción finalizada correctamente", "success");
                
                // Mostrar el texto completo
                transcriptText.textContent = data.fullText;
                
                // Ocultar progreso y mostrar resultados
                setTimeout(() => {
                    progressContainer.classList.add('hidden');
                    resultsContainer.classList.remove('hidden');
                }, 1000);
                break;
                
            case 'error':
                progressText.textContent = "Error en la transcripción";
                addLogMessage(data.message, "error");
                
                // Mostrar detalles del error
                showError(data.message);
                
                // Ocultar progreso
                setTimeout(() => {
                    progressContainer.classList.add('hidden');
                }, 1000);
                break;
        }
    }
    
    // Actualizar indicador visual de fragmento
    function updateChunkIndicator(chunkNumber, status) {
        const miniChunk = document.querySelector(`.mini-chunk[data-chunk="${chunkNumber}"]`);
        if (miniChunk) {
            switch(status) {
                case 'success':
                    miniChunk.style.backgroundColor = '#34a853'; // Verde
                    break;
                case 'error':
                    miniChunk.style.backgroundColor = '#ea4335'; // Rojo
                    break;
                case 'retry':
                    miniChunk.style.backgroundColor = '#fbbc05'; // Amarillo
                    break;
                case 'processing':
                    miniChunk.style.backgroundColor = '#4285f4'; // Azul
                    break;
            }
        }
    }
    
    // Añadir mensaje al log
    function addLogMessage(message, type = 'info') {
        const logContainer = document.getElementById('fragments-log');
        if (!logContainer) return;
        
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;
        logEntry.style.marginBottom = '5px';
        
        // Estilos según tipo
        switch(type) {
            case 'error':
                logEntry.style.color = '#ea4335';
                break;
            case 'success':
                logEntry.style.color = '#34a853';
                logEntry.style.fontWeight = 'bold';
                break;
            case 'warning':
                logEntry.style.color = '#fbbc05';
                break;
            default:
                logEntry.style.color = '#5f6368';
        }
        
        const timestamp = new Date().toLocaleTimeString();
        logEntry.textContent = `[${timestamp}] ${message}`;
        
        logContainer.appendChild(logEntry);
        
        // Auto-scroll al final
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    // Mostrar mensaje de error
    function showError(message) {
        errorMessage.textContent = message;
        errorContainer.classList.remove('hidden');
    }

    // Reiniciar el proceso
    function resetUpload() {
        selectedFile = null;
        fileInput.value = '';
        fileInfo.classList.add('hidden');
        progressContainer.classList.add('hidden');
        resultsContainer.classList.add('hidden');
        errorContainer.classList.add('hidden');
        progressBar.style.width = '0%';
        
        // Cerrar EventSource si existe
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
        
        // Remover elementos adicionales
        const warningEl = document.getElementById('duration-warning');
        if (warningEl) warningEl.remove();
        
        const detailsContainer = document.getElementById('progress-details');
        if (detailsContainer) detailsContainer.remove();
        
        const cancelBtn = document.getElementById('cancel-processing-btn');
        if (cancelBtn) cancelBtn.remove();
    }

    // Cancelar la carga
    cancelBtn.addEventListener('click', resetUpload);

    // Intentar de nuevo después de error
    errorRetryBtn.addEventListener('click', resetUpload);

    // Nueva transcripción después de resultados
    newUploadBtn.addEventListener('click', resetUpload);

    // Copiar transcripción
    copyBtn.addEventListener('click', function() {
        const text = transcriptText.textContent;
        navigator.clipboard.writeText(text).then(() => {
            // Opcional: dar feedback visual de que se copió
            const originalText = copyBtn.textContent;
            copyBtn.textContent = 'Copiado!';
            setTimeout(() => {
                copyBtn.textContent = originalText;
            }, 2000);
        }).catch(err => {
            console.error('Error al copiar: ', err);
        });
    });

// Descargar transcripción
downloadBtn.addEventListener('click', function() {
    const text = transcriptText.textContent;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    
    // Nombre del archivo basado en el archivo original
    let downloadName = 'transcripcion.txt';
    if (selectedFile) {
        const origName = selectedFile.name.split('.').slice(0, -1).join('.');
        downloadName = origName + '-transcripcion.txt';
    }
    
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    
    // Limpieza
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 0);
});

// Permitir hacer clic en cualquier parte del área de carga
dropArea.addEventListener('click', function() {
    fileInput.click();
});
});