// Configuración global
const SENSOR_PINS = [17, 27, 4, 5, 6, 13, 18, 22, 26, 19];
const SENSOR_CHECK_INTERVAL = 500;

let currentMode = 'background';
let lastActiveSensors = [];
let isTransitioning = false;
let autoplayInitialized = false;
let lastCheckTime = 0;
let debounceTimeout = null;

const DEBUG = localStorage.getItem('debugEnabled') === 'true';
const debugPanel = document.getElementById('debug-panel');

function debugLog(message) {
    if (localStorage.getItem('debugEnabled') === 'true') {
        const panel = document.getElementById('debug-panel');
        if (panel) {
            panel.style.display = 'block';
            panel.style.width = '300px';  // Ancho fijo
            panel.style.maxHeight = '300px'; // Altura máxima
            panel.style.backgroundColor = 'rgba(0,0,0,0.8)'; // Fondo más oscuro
            panel.style.color = '#fff'; // Texto blanco
            panel.style.fontSize = '12px'; // Tamaño de texto
            panel.style.padding = '10px'; // Padding
            panel.style.fontFamily = 'monospace'; // Fuente monoespaciada
            
            const time = new Date().toLocaleTimeString();
            panel.innerHTML = `${time}: ${message}<br>${panel.innerHTML}`.split('<br>').slice(0, 50).join('<br>');
            console.log(`[DEBUG] ${time}: ${message}`); // Mantener logs en consola
        }
    } else {
        debugPanel.style.display = 'none';
    }
}


window.addEventListener('storage', function(e) {
    if (e.key === 'debugEnabled') {
        debugPanel.style.display = e.newValue === 'true' ? 'block' : 'none';
    }
});

document.addEventListener('DOMContentLoaded', () => {
    debugPanel.style.display = localStorage.getItem('debugEnabled') === 'true' ? 'block' : 'none';
});

// Sistema de reproducción de fondo
let backgroundPlayer = {
    video: null,
    playlist: [],
    currentIndex: 0,
    isPlaying: false
};

function debugLog(message) {
    if (DEBUG) {
        const panel = document.getElementById('debug-panel');
        const time = new Date().toLocaleTimeString();
        panel.innerHTML = `${time}: ${message}<br>${panel.innerHTML}`.split('<br>').slice(0, 50).join('<br>');
        console.log(message);
    }
}

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
    setupVideoEventListeners();
    await initBackgroundPlaylist();
    startSensorMonitoring();
    initAutoplay();
});

function setupVideoEventListeners() {
    const backgroundVideo = document.getElementById('background-video');
    const video1 = document.getElementById('video1');
    const video2 = document.getElementById('video2');

    backgroundPlayer.video = backgroundVideo;

    [backgroundVideo, video1, video2].forEach(video => {
        video.addEventListener('play', () => {
            debugLog(`Video iniciado: ${video.id}`);
        });

        video.addEventListener('error', (e) => {
            debugLog(`Error en video ${video.id}: ${e.message}`);
        });
    });

    backgroundVideo.addEventListener('ended', () => {
        if (currentMode === 'background') {
            playNextInPlaylist();
        }
    });
}

async function initBackgroundPlaylist() {
    await loadBackgroundVideos();
    if (backgroundPlayer.playlist.length > 0) {
        playCurrentVideo();
    }
}

function playNextInPlaylist() {
    if (currentMode !== 'background') return;
    
    backgroundPlayer.currentIndex = (backgroundPlayer.currentIndex + 1) % backgroundPlayer.playlist.length;
    debugLog(`Avanzando al siguiente video: ${backgroundPlayer.currentIndex + 1}/${backgroundPlayer.playlist.length}`);
    playCurrentVideo();
}

async function playCurrentVideo() {
    if (!backgroundPlayer.playlist.length) return;
    
    const currentVideo = backgroundPlayer.playlist[backgroundPlayer.currentIndex];
    debugLog(`Reproduciendo video ${backgroundPlayer.currentIndex + 1}/${backgroundPlayer.playlist.length}: ${currentVideo.video_path}`);
    
    try {
        backgroundPlayer.video.src = `/static/${currentVideo.video_path}`;
        backgroundPlayer.video.load();
        await backgroundPlayer.video.play();
        backgroundPlayer.isPlaying = true;
    } catch (error) {
        debugLog(`Error reproduciendo video: ${error.message}`);
        setTimeout(playNextInPlaylist, 1000);
    }
}

async function initAutoplay() {
    try {
        await backgroundPlayer.video.play();
        autoplayInitialized = true;
    } catch (error) {
        debugLog('Esperando interacción para autoplay');
        document.addEventListener('click', async () => {
            if (!autoplayInitialized) {
                await initAutoplay();
            }
        }, { once: true });
    }
}

function startSensorMonitoring() {
    setInterval(checkSensors, SENSOR_CHECK_INTERVAL);
}

async function checkSensors() {
    const now = Date.now();
    if (now - lastCheckTime < SENSOR_CHECK_INTERVAL || isTransitioning) return;
    lastCheckTime = now;

    try {
        const response = await fetch('/api/sensor_status');
        const data = await response.json();
        const activeSensors = data.active_sensors;

        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(async () => {
            if (JSON.stringify(activeSensors) !== JSON.stringify(lastActiveSensors)) {
                debugLog(`Cambio en sensores: ${activeSensors.join(', ')}`);
                await handleSensorChange(activeSensors);
                lastActiveSensors = activeSensors;
            }
        }, 300);
    } catch (error) {
        debugLog(`Error en monitoreo: ${error.message}`);
    }
}

async function handleSensorChange(activeSensors) {
    if (isTransitioning) return;
    isTransitioning = true;

    try {
        if (activeSensors.length === 0) {
            await switchToBackgroundMode();
        } else if (activeSensors.length === 1) {
            await switchToSingleMode(activeSensors[0]);
        } else {
            const recentSensors = activeSensors.slice(-2);
            await switchToVersusMode(recentSensors[0], recentSensors[1]);
        }
    } catch (error) {
        debugLog(`Error en cambio de modo: ${error.message}`);
        await switchToBackgroundMode();
    } finally {
        isTransitioning = false;
    }
}

async function loadBackgroundVideos() {
    try {
        const response = await fetch('/api/background_videos');
        const videos = await response.json();
        
        if (videos && videos.length > 0) {
            backgroundPlayer.playlist = videos.sort((a, b) => a.orden - b.orden);
            debugLog(`Playlist cargada: ${videos.length} videos`);
            if (currentMode === 'background' && !backgroundPlayer.isPlaying) {
                backgroundPlayer.currentIndex = 0;
                await playCurrentVideo();
            }
        }
    } catch (error) {
        debugLog(`Error cargando playlist: ${error.message}`);
    }
}

async function switchToBackgroundMode() {
    debugLog('Cambiando a modo fondo');
    
    const splitScreen = document.querySelector('.split-screen');
    const video1 = document.getElementById('video1');
    const video2 = document.getElementById('video2');
    
    // Detener videos del modo versus
    [video1, video2].forEach(video => {
        video.pause();
        video.currentTime = 0;
        video.src = '';
    });

    // Preparar video de fondo
    backgroundPlayer.video.style.display = 'block';
    splitScreen.style.display = 'none';
    
    currentMode = 'background';
    backgroundPlayer.isPlaying = false;
    backgroundPlayer.currentIndex = 0;
    
    await loadBackgroundVideos();
}

async function switchToSingleMode(sensorId) {
    debugLog(`Cambiando a modo único - Sensor ${sensorId}`);
    try {
        const response = await fetch(`/api/sensor_video/${sensorId}`);
        const data = await response.json();

        if (data.video_path) {
            backgroundPlayer.isPlaying = false;
            const splitScreen = document.querySelector('.split-screen');
            
            splitScreen.style.display = 'none';
            backgroundPlayer.video.style.display = 'block';
            backgroundPlayer.video.src = `/static/${data.video_path}`;
            
            // Aplicar estado de mute
            const muted = localStorage.getItem(`sensor_${sensorId}_muted`) === 'true';
            backgroundPlayer.video.muted = muted;
            
            if (autoplayInitialized) {
                await backgroundPlayer.video.play();
            }
            
            currentMode = 'single';
        } else {
            throw new Error('No hay video asignado');
        }
    } catch (error) {
        debugLog(`Error en modo único: ${error.message}`);
        await switchToBackgroundMode();
    }
}

async function switchToVersusMode(sensor1, sensor2) {
    debugLog(`Iniciando versus: ${sensor1} vs ${sensor2}`);
    
    // Detener todos los videos activos
    stopAllVideos();
    
    const splitScreen = document.querySelector('.split-screen');
    const video1 = document.getElementById('video1');
    const video2 = document.getElementById('video2');

    try {
        const [resp1, resp2] = await Promise.all([
            fetch(`/api/sensor_video/${sensor1}`),
            fetch(`/api/sensor_video/${sensor2}`)
        ]);
        
        const [data1, data2] = await Promise.all([resp1.json(), resp2.json()]);
        
        if (!data1.video_path || !data2.video_path) {
            throw new Error('Faltan videos para versus');
        }

        backgroundPlayer.video.style.display = 'none';
        splitScreen.style.display = 'flex';

        // Aplicar estados de mute
        video1.muted = localStorage.getItem(`sensor_${sensor1}_muted`) === 'true';
        video2.muted = localStorage.getItem(`sensor_${sensor2}_muted`) === 'true';

        // Configurar videos
        video1.src = `/static/${data1.video_path}`;
        video2.src = `/static/${data2.video_path}`;
        
        [video1, video2].forEach(video => video.loop = true);

        await Promise.all([video1.play(), video2.play()]);
        
        currentMode = 'versus';
        debugLog('Versus activado');
    } catch (error) {
        debugLog(`Error en versus: ${error.message}`);
        await switchToBackgroundMode();
    }
}

// Agregar función para detener todos los videos
function stopAllVideos() {
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
        video.pause();
        video.currentTime = 0;
    });
}