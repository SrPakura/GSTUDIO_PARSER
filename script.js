/* =========================================
   AERKO_ LOG CLEANER // CORE LOGIC v2.0
   ========================================= */

// --- VARIABLES GLOBALES ---
let rawData = null;
let processedText = "";
let stats = { total_pairs: 0, omitted: 0, thoughts: 0 };

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

// 2. Live Preview
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
            const json = JSON.parse(e.target.result);
            if (!json.chunkedPrompt || !json.chunkedPrompt.chunks) {
                throw new Error("Estructura JSON no válida (Falta chunkedPrompt)");
            }
            rawData = json;
            
            elements.fileStatus.style.display = 'block';
            elements.fileStatus.innerText = `> ARCHIVO CARGADO: ${file.name}`;
            elements.fileStatus.style.color = 'var(--acid)';
            elements.configSection.classList.remove('disabled-state');
            elements.exportSection.classList.remove('disabled-state');
            
            processAndRender();

        } catch (error) {
            alert("ERROR CRÍTICO: " + error.message);
            elements.fileStatus.style.display = 'block';
            elements.fileStatus.innerText = `> ERROR DE LECTURA`;
            elements.fileStatus.style.color = 'red';
        }
    };
    reader.readAsText(file);
}

function extractTextFromChunk(chunk) {
    // Función auxiliar para sacar texto limpio de cualquier estructura rara del JSON
    let text = "";
    if (chunk.parts && Array.isArray(chunk.parts)) {
        text = chunk.parts.map(p => p.text || "").join("");
    } else {
        text = chunk.text || "";
    }
    return text.trim();
}

function processAndRender() {
    if (!rawData) return;

    // 1. Configuración
    const config = {
        userAlias: elements.nameUser.value || "Usuario",
        modelAlias: elements.nameModel.value || "Lucy",
        omitList: elements.omitIds.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)),
        thoughtStart: parseInt(elements.thoughtStart.value) || 0,
        thoughtEnd: parseInt(elements.thoughtEnd.value) || 0,
        headerTemplate: elements.headerText.value
    };

    const chunks = rawData.chunkedPrompt.chunks;
    let cleanConversation = [];
    
    // Contadores Independientes
    let countUser = 0;
    let countModel = 0;

    // Variables temporales
    let pendingThought = ""; // Buffer para guardar pensamientos antes de la respuesta

    // ESTADÍSTICAS
    stats.total_pairs = 0; 
    stats.omitted = 0;
    stats.thoughts = 0;

    // PASO 1: Calcular totales REALES para la lógica de "últimos X"
    // Contamos cuántas respuestas tiene el modelo (excluyendo pensamientos puros)
    let totalModelResponses = chunks.filter(c => c.role === 'model' && !c.isThought).length;

    // PASO 2: Procesar
    for (const chunk of chunks) {
        
        // --- DETECTAR PENSAMIENTO ---
        // A veces viene como chunk entero (isThought: true) o dentro de 'parts' con thought: true
        let isThinkingChunk = chunk.isThought || (chunk.parts && chunk.parts.some(p => p.thought));
        
        if (isThinkingChunk) {
            // Extraemos el texto del pensamiento y lo guardamos en el buffer
            let thoughtContent = extractTextFromChunk(chunk);
            if (thoughtContent) {
                pendingThought += thoughtContent + "\n";
            }
            // NO añadimos nada al array final todavía, esperamos al mensaje real
            continue; 
        }

        // --- MENSAJES NORMALES ---
        let role = chunk.role;
        let currentID = 0; // El número que se mostrará (0001, 0002...)
        let label = "";
        let finalMessage = "";
        let isOmitted = false;

        if (role === 'user') {
            countUser++;
            currentID = countUser;
            label = `${config.userAlias} ${String(currentID).padStart(4, '0')}`;
            
            // Si hay un pensamiento "colgando" y cambiamos a usuario, lo borramos (o lo añadimos si quisieras)
            // Normalmente el usuario no tiene pensamientos en este formato.
            pendingThought = ""; 

        } else if (role === 'model') {
            countModel++;
            currentID = countModel; // Usamos su propio contador
            label = `${config.modelAlias} ${String(currentID).padStart(4, '0')}`;
        } else {
            continue; // Roles desconocidos (system, tool, etc)
        }

        // --- CHEQUEO DE OMISIÓN ---
        // Si el usuario pone "1", ocultamos User 1 y Model 1.
        if (config.omitList.includes(currentID)) {
            isOmitted = true;
            stats.omitted++;
            cleanConversation.push(`${label}:\n[MENSAJE OMITIDO]`);
            // Limpiamos buffer si se omite
            pendingThought = ""; 
            continue;
        }

        // --- CONSTRUCCIÓN DEL TEXTO ---
        let mainText = extractTextFromChunk(chunk);

        // Si es Modelo, miramos si hay que inyectar el Pensamiento guardado
        if (role === 'model' && pendingThought.length > 0) {
            // Lógica: ¿Debemos mostrarlo?
            // "Primeros X" -> Si countModel <= config.thoughtStart
            // "Últimos X" -> Si countModel > (totalModelResponses - config.thoughtEnd)
            
            const showFirst = countModel <= config.thoughtStart;
            const showLast = countModel > (totalModelResponses - config.thoughtEnd);

            if (showFirst || showLast) {
                finalMessage += `[PENSAMIENTO]:\n${pendingThought}\n[RESPUESTA]:\n`;
                stats.thoughts++;
            }
            // Limpiamos el buffer tras usarlo (o descartarlo)
            pendingThought = "";
        }

        finalMessage += mainText;

        // Añadir a la lista
        cleanConversation.push(`${label}:\n${finalMessage}`);
    }
    
    // Actualizamos stats.total_pairs al mayor de los dos contadores
    stats.total_pairs = Math.max(countUser, countModel);

    // 3. Cabecera
    let headerFinal = config.headerTemplate
        .replace('[TOTAL]', stats.total_pairs)
        .replace('[OMITIDOS]', stats.omitted)
        .replace('[PENSAMIENTOS]', stats.thoughts);

    processedText = headerFinal + "\n\n" + "-".repeat(40) + "\n\n" + cleanConversation.join("\n\n");

    // 4. Render
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
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFont("courier", "normal"); 
    doc.setFontSize(10);
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 10;
    const maxLineWidth = pageWidth - (margin * 2);
    const splitText = doc.splitTextToSize(processedText, maxLineWidth);
    
    let cursorY = 15;
    const pageHeight = doc.internal.pageSize.getHeight();

    splitText.forEach(line => {
        if (cursorY > pageHeight - 10) {
            doc.addPage();
            cursorY = 15;
        }
        doc.text(line, margin, cursorY);
        cursorY += 5;
    });

    doc.save(`chat_clean_${Date.now()}.pdf`);
}
