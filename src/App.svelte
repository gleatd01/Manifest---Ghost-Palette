<script>
    import { onMount, tick } from 'svelte';
    import { io } from 'socket.io-client';
    import * as pdfjsLib from 'pdfjs-dist';

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    // Catch the build-arg value injected by Vite at compile time
    const appVersion = __APP_VERSION__;

    let user = null;
    let tasks = [];
    let allUsers = []; 
    let currentView = 'list';
    let editingTask = null;
    let isStudyMode = false;
    let isHeaderCollapsed = false;
    
    let showAssignees = false;
    let showDependencies = false;
    let showReminder = false;
    let selectedDep = null;
    let selectedAssignee = null;
    
    // PDF & Viewer variables
    let pdfContainerRef;
    let canvasRef;
    let pdfDoc = null;
    let
