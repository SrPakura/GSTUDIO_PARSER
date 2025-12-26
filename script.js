/* =========================================
   AERKO_ LOG CLEANER // CORE LOGIC
   ========================================= */

// --- VARIABLES GLOBALES ---
let rawData = null; // El JSON crudo
let processedText = ""; // El texto final limpio
let stats = { total: 0, omitted: 0, thoughts: 0 };

// --- DOM ELEMENTS ---
const elements = {
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    fileStatus: document.getElementById('file-status'),
    configSection: document.getElementById('config-section'),
    exportSection: document.getElementById('export-section'),
    previewBox: document.getElementById('preview-box'),
    
    // Inputs
    nameUser: document.getElementById('name-user'),
    nameModel: document.getElementById('name-model'),
    headerText: document.getElementById('custom-header'),
    omitIds: document.getElementById('omit-ids'),
    thoughtStart: document.getElementById('thought-start'),
    thoughtEnd: document.getElementById('thought-end'),
    
    // Botones
    btnTxt: document.getElementById('btn-txt'),
    btnPdf: document.getElementById('btn-pdf')
};

// --- EVENT LISTENERS ---

// 1. Drag & Drop
elements.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.dropZone.querySelector('.upload-area').classList.add('dragover');
});
elements.dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    elements.dropZone.querySelector('.upload-area').classList.remove('dragover');
});
elements.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.dropZone.querySelector('.upload-area').classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    handleFile(file);
});
elements.fileInput.addEventListener('change', (e) => {
    if(e.target.files.length > 0) handleFile(e.target.files[0]);
});

// 2. Live Preview (Cualquier cambio en inputs regenera la vista)
const inputs = [elements.nameUser, elements.nameModel, elements.headerText, elements.omitIds, elements.thoughtStart, elements.thoughtEnd];
inputs.forEach(input => input.addEventListener('input', processAndRender));

// 3. Export
elements.btnTxt.addEventListener('click', downloadTXT);
elements.btnPdf.addEventListener('click', downloadPDF);

// --- FUNCIONES ---

function handleFile(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            // Intentamos parsear sea cual sea la extensión
            const json = JSON.parse(e.target.result);
            
            // Verificación básica de estructura AI Studio
            if (!json.chunkedPrompt || !json.chunkedPrompt.chunks) {
                throw new Error("Estructura JSON no válida (Falta chunkedPrompt)");
            }

            rawData = json;
            
            // UI Update
            elements.fileStatus.style.display = 'block';
            elements.fileStatus.innerText = `> ARCHIVO CARGADO: ${file.name}`;
            elements.configSection.classList.remove('disabled-state');
            elements.exportSection.classList.remove('disabled-state');
            
            processAndRender();

        } catch (error) {
            alert("ERROR CRÍTICO: El archivo no es un JSON válido o la estructura es incorrecta.\n\n" + error.message);
            elements.fileStatus.style.display = 'block';
            elements.fileStatus.innerText = `> ERROR DE LECTURA`;
            elements.fileStatus.classList.remove('text-acid');
            elements.fileStatus.style.color = 'red';
        }
    };
    reader.readAsText(file); // Leemos como texto plano para ignorar extensiones
}

function processAndRender() {
    if (!rawData) return;

    // 1. Recoger Configuración
    const config = {
        userAlias: elements.nameUser.value || "Usuario",
        modelAlias: elements.nameModel.value || "Lucy",
        omitList: elements.omitIds.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)),
        thoughtStart: parseInt(elements.thoughtStart.value) || 0,
        thoughtEnd: parseInt(elements.thoughtEnd.value) || 0,
        headerTemplate: elements.headerText.value
    };

    // 2. Procesar Datos
    const chunks = rawData.chunkedPrompt.chunks;
    let cleanConversation = [];
    let msgCounter = 0; // Contador global de mensajes visuales (User + Model)
    
    // Contadores internos para IDs relativos
    stats.total = 0;
    stats.omitted = 0;
    stats.thoughts = 0;

    // Primero contamos mensajes reales (User/Model) para la lógica de "últimos X"
    const totalValidMessages = chunks.filter(c => !c.isThought && (c.role === 'user' || c.role === 'model')).length;
    let currentMsgIndex = 0;

    for (const chunk of chunks) {
        // Ignoramos bloques que son SOLO pensamiento (nivel superior)
        if (chunk.isThought) continue;
        
        if (chunk.role === 'user' || chunk.role === 'model') {
            msgCounter++;
            currentMsgIndex++;
            stats.total++;

            // --- Lógica de Nombres ---
            const alias = chunk.role === 'user' ? config.userAlias : config.modelAlias;
            const label = `${alias} ${String(msgCounter).padStart(4, '0')}`;

            // --- Lógica de Omisión (Por ID) ---
            if (config.omitList.includes(msgCounter)) {
                cleanConversation.push(`${label}: [MENSAJE OMITIDO]`);
                stats.omitted++;
                continue;
            }

            // --- Extracción de Texto ---
            let fullText = "";
            let hasThought = false;

            if (chunk.parts && Array.isArray(chunk.parts)) {
                // El chunk tiene partes. Aquí es donde pueden estar los pensamientos mezclados.
                for (const part of chunk.parts) {
                    // Ver si es un pensamiento interno
                    const isThoughtPart = part.thought === true; // A veces viene así en el JSON

                    if (isThoughtPart) {
                        hasThought = true;
                        // Lógica: ¿Debemos mostrar este pensamiento?
                        const showFirst = currentMsgIndex <= config.thoughtStart;
                        const showLast = currentMsgIndex > (totalValidMessages - config.thoughtEnd);
                        
                        if (showFirst || showLast) {
                            // Limpiamos el pensamiento
                            fullText += `\n[PENSAMIENTO]: ${part.text.trim()}\n`;
                            stats.thoughts++;
                        }
                    } else {
                        // Texto normal
                        fullText += part.text || "";
                    }
                }
            } else {
                // Texto simple sin partes
                fullText = chunk.text || "";
            }

            fullText = fullText.trim();
            if (!fullText && !config.omitList.includes(msgCounter)) continue; // Si está vacío y no fue omitido explícitamente

            cleanConversation.push(`${label}:\n${fullText}`);
        }
    }

    // 3. Generar Cabecera Dinámica
    let headerFinal = config.headerTemplate
        .replace('[TOTAL]', stats.total)
        .replace('[OMITIDOS]', stats.omitted)
        .replace('[PENSAMIENTOS]', stats.thoughts);

    processedText = headerFinal + "\n\n" + "-".repeat(40) + "\n\n" + cleanConversation.join("\n\n");

    // 4. Renderizar Preview
    elements.previewBox.innerText = processedText;
}

function downloadTXT() {
    if (!processedText) return;
    const blob = new Blob([processedText], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat_clean_${Date.now()}.txt`;
    a.click();
    window.URL.revokeObjectURL(url);
}

function downloadPDF() {
    if (!processedText) return;
    
    // Usamos jsPDF
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    // Configuración de fuente monoespaciada básica
    doc.setFont("courier", "normal"); 
    doc.setFontSize(10);
    
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 10;
    const maxLineWidth = pageWidth - (margin * 2);

    // Separar por líneas para manejar saltos de página
    const splitText = doc.splitTextToSize(processedText, maxLineWidth);
    
    let cursorY = 15;
    const pageHeight = doc.internal.pageSize.getHeight();

    splitText.forEach(line => {
        if (cursorY > pageHeight - 10) {
            doc.addPage();
            cursorY = 15;
        }
        doc.text(line, margin, cursorY);
        cursorY += 5; // Interlineado
    });

    doc.save(`chat_clean_${Date.now()}.pdf`);
}
