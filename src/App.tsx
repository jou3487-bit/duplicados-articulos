import React, { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { 
  Plus, 
  Trash2, 
  RotateCcw, 
  Sparkles, 
  Upload, 
  FileJson, 
  FileSpreadsheet, 
  Copy, 
  Check, 
  HelpCircle, 
  Tag, 
  Boxes, 
  Layers, 
  Database, 
  Code,
  Edit2,
  AlertCircle,
  TrendingUp,
  RefreshCw,
  Search,
  LogIn,
  LogOut,
  User as UserIcon,
  Lock,
  Mail,
  Cloud
} from "lucide-react";
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  User
} from "firebase/auth";
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  addDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  deleteDoc, 
  updateDoc 
} from "firebase/firestore";
import { auth, db } from "./firebase";
import { ClassifiedItem, OracleFusionPayload } from "./types";

// Default initial Oracle Purchasing Categories
const DEFAULT_CATEGORIES = [
  "RODAMIENTOS Y TRANSMISION DE POTENCIA",
  "PERNERIA Y ELEMENTOS DE FIJACION",
  "EPP Y SEGURIDAD INDUSTRIAL",
  "HERRAMIENTAS MANUALES Y ELECTRICAS",
  "MATERIALES ELECTRICOS Y CANALIZACIONES",
  "EQUIPAMIENTO DE OFICINA Y PAPELERIA",
  "SOPORTE Y SERVICIOS TI",
  "REPUESTOS DE MAQUINARIA PESADA",
  "TUBERIAS Y ACCESORIOS DE CONEXION",
  "PRODUCTOS QUIMICOS Y LUBRICANTES",
  "SERVICIOS GENERALES Y MANTENIMIENTO"
];

// Pre-loaded samples for quick evaluation
const SAMPLE_ITEMS = [
  "Balinera FAG 6205 C3 doble sello de metal",
  "Perno milimetrico cabeza hexagonal de 1/2 x 2 pulgadas con tuerca de grado 8",
  "Botas de seguridad dieléctricas caña alta marca Caterpillar talla 42 color negro",
  "Cable de cobre monopolar numero 12 AWG marca Indeco color rojo rollo de 100m",
  "Llave francesa Bahco ajustable de 10 pulgadas mango cromado",
  "Cartucho de tinta HP 667 XL color tricolor original",
  "Grasa multipropósito Mobilux EP2 balde de 16kg",
  "Válvula de bola de bronce de 3/4 pulgada NPT marca Giacomini"
];

export default function App() {
  // Category configuration state
  const [categories, setCategories] = useState<string[]>(() => {
    const saved = localStorage.getItem("oracle_purchasing_categories");
    return saved ? JSON.parse(saved) : DEFAULT_CATEGORIES;
  });
  const [newCategory, setNewCategory] = useState("");
  const [showBulkCategoryUpload, setShowBulkCategoryUpload] = useState(false);
  const [bulkCategoryText, setBulkCategoryText] = useState("");
  const categoryFileInputRef = useRef<HTMLInputElement>(null);

  // Input states
  const [singleDescription, setSingleDescription] = useState("");
  const [bulkInputText, setBulkInputText] = useState("");
  const [activeTab, setActiveTab] = useState<"single" | "bulk">("single");
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // App states
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<ClassifiedItem[]>([]);
  const [filterText, setFilterText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // States for high-volume batch processing progress tracking
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchProcessed, setBatchProcessed] = useState(0);
  const [batchSuccessCount, setBatchSuccessCount] = useState(0);
  const [batchFailCount, setBatchFailCount] = useState(0);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);

  // Firebase auth form states
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authIsSignUp, setAuthIsSignUp] = useState(false);
  const [authError, setAuthError] = useState<React.ReactNode | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  // UI States
  const [copiedPython, setCopiedPython] = useState(false);
  const [copiedIngestPython, setCopiedIngestPython] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingItem, setEditingItem] = useState<ClassifiedItem | null>(null);

  // Confirmation Modal State
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    actionType: "logout" | "reset_categories" | "clear_history" | null;
  }>({
    isOpen: false,
    title: "",
    message: "",
    actionType: null,
  });

  const triggerConfirm = (
    title: string,
    message: string,
    actionType: "logout" | "reset_categories" | "clear_history"
  ) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      actionType,
    });
  };

  const executeConfirmedAction = async () => {
    const action = confirmModal.actionType;
    setConfirmModal({ isOpen: false, title: "", message: "", actionType: null });
    
    if (action === "logout") {
      try {
        await signOut(auth);
        setResults([]);
        setCategories(DEFAULT_CATEGORIES);
      } catch (err) {
        console.error("Error cerrando sesión:", err);
      }
    } else if (action === "reset_categories") {
      saveCategories(DEFAULT_CATEGORIES);
    } else if (action === "clear_history") {
      setResults([]);
      if (user) {
        try {
          const q = query(
            collection(db, "classified_items"),
            where("userId", "==", user.uid)
          );
          const querySnapshot = await getDocs(q);
          const deletePromises = querySnapshot.docs.map(docSnap => deleteDoc(doc(db, "classified_items", docSnap.id)));
          await Promise.all(deletePromises);
        } catch (err) {
          console.error("Error al limpiar historial en Firestore:", err);
        }
      }
    }
  };

  // Listen to Auth State and Sync with Firestore
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Load custom categories from Firestore
        try {
          const settingsRef = doc(db, "user_settings", currentUser.uid);
          const settingsSnap = await getDoc(settingsRef);
          if (settingsSnap.exists()) {
            const data = settingsSnap.data();
            if (data && Array.isArray(data.categories)) {
              setCategories(data.categories);
            }
          } else {
            // First time: try loading global settings first, fallback to DEFAULT_CATEGORIES
            let initialCats = DEFAULT_CATEGORIES;
            try {
              const globalRef = doc(db, "global_settings", "categories");
              const globalSnap = await getDoc(globalRef);
              if (globalSnap.exists()) {
                const globalData = globalSnap.data();
                if (globalData && Array.isArray(globalData.categories)) {
                  initialCats = globalData.categories;
                }
              }
            } catch (globalErr) {
              console.warn("No se pudieron cargar las categorías globales, usando valores por defecto:", globalErr);
            }

            // Write initial categories
            await setDoc(settingsRef, {
              userId: currentUser.uid,
              categories: initialCats,
              updatedAt: new Date().toISOString()
            });
            setCategories(initialCats);
          }
        } catch (err) {
          console.error("Error cargando categorías de Firestore:", err);
        }

        // Load classified items history from Firestore
        try {
          const q = query(
            collection(db, "classified_items"),
            where("userId", "==", currentUser.uid),
            orderBy("createdAt", "desc")
          );
          const querySnapshot = await getDocs(q);
          const loadedResults: ClassifiedItem[] = [];
          querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            loadedResults.push({
              id: docSnap.id,
              originalDescription: data.originalDescription || "",
              purchasingCategory: data.purchasingCategory || "",
              standardizedDescription: data.standardizedDescription || "",
              brand: data.brand || "",
              partNumber: data.partNumber || "",
              uom: data.uom || "",
              confidence: data.confidence || 0,
              explanation: data.explanation || "",
              createdAt: data.createdAt
            });
          });
          setResults(loadedResults);
        } catch (err) {
          console.error("Error cargando historial de Firestore (con orderBy):", err);
          // Fallback if index is building or not present
          try {
            const qSimple = query(
              collection(db, "classified_items"),
              where("userId", "==", currentUser.uid)
            );
            const querySnapshot = await getDocs(qSimple);
            const loadedResults: ClassifiedItem[] = [];
            querySnapshot.forEach((docSnap) => {
              const data = docSnap.data();
              loadedResults.push({
                id: docSnap.id,
                originalDescription: data.originalDescription || "",
                purchasingCategory: data.purchasingCategory || "",
                standardizedDescription: data.standardizedDescription || "",
                brand: data.brand || "",
                partNumber: data.partNumber || "",
                uom: data.uom || "",
                confidence: data.confidence || 0,
                explanation: data.explanation || "",
                createdAt: data.createdAt
              });
            });
            // Sort client-side
            loadedResults.sort((a, b) => {
              const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
              const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
              return dateB - dateA;
            });
            setResults(loadedResults);
          } catch (simpleErr) {
            console.error("Simple fallback history loading failed:", simpleErr);
          }
        }
      } else {
        // User is not logged in, try loading global categories if present, otherwise local
        console.log("Sesión local activa (Sin usuario en la nube). Intentando cargar catálogo global...");
        try {
          const globalRef = doc(db, "global_settings", "categories");
          const globalSnap = await getDoc(globalRef);
          if (globalSnap.exists()) {
            const globalData = globalSnap.data();
            if (globalData && Array.isArray(globalData.categories)) {
              setCategories(globalData.categories);
            }
          }
        } catch (err) {
          console.warn("No se pudo cargar el catálogo global como invitado, usando local/defecto:", err);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Save categories to local storage and sync to Firestore
  const saveCategories = async (newCats: string[]) => {
    setCategories(newCats);
    localStorage.setItem("oracle_purchasing_categories", JSON.stringify(newCats));
    
    if (user) {
      try {
        const settingsRef = doc(db, "user_settings", user.uid);
        await setDoc(settingsRef, {
          userId: user.uid,
          categories: newCats,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } catch (err) {
        console.error("Error sincronizando categorías a Firestore:", err);
      }
    }
  };

  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCat = newCategory.trim().toUpperCase();
    if (cleanCat && !categories.includes(cleanCat)) {
      const updated = [...categories, cleanCat];
      saveCategories(updated);
      setNewCategory("");
    }
  };

  const handleRemoveCategory = (index: number) => {
    const updated = categories.filter((_, i) => i !== index);
    saveCategories(updated);
  };

  const handleResetCategories = () => {
    triggerConfirm(
      "Restablecer Catálogo",
      "¿Está seguro de que desea restablecer el catálogo de categorías por defecto? Se perderán las categorías personalizadas agregadas.",
      "reset_categories"
    );
  };

  const handleBulkCategoryImport = (replace: boolean) => {
    if (!bulkCategoryText.trim()) return;
    const imported = bulkCategoryText
      .split(/\r?\n/)
      .map(line => line.trim().toUpperCase())
      .filter(line => line.length > 0 && !line.startsWith("#"));
    
    if (imported.length === 0) return;

    let updated: string[];
    if (replace) {
      updated = imported;
    } else {
      updated = Array.from(new Set([...categories, ...imported]));
    }

    saveCategories(updated);
    setBulkCategoryText("");
    setShowBulkCategoryUpload(false);
  };

  const handleCategoryFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleCategoryFile(e.target.files[0]);
    }
  };

  const handleCategoryFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (text) {
        const lines = text
          .split(/\r?\n/)
          .map(line => {
            if (line.includes(",")) {
              const columns = line.split(",");
              return columns[0].replace(/^"|"$/g, "").trim();
            }
            if (line.includes(";")) {
              const columns = line.split(";");
              return columns[0].replace(/^"|"$/g, "").trim();
            }
            return line.trim();
          })
          .map(line => line.toUpperCase())
          .filter(line => line.length > 0 && !line.startsWith("#") && !line.toLowerCase().startsWith("categoria") && !line.toLowerCase().startsWith("category"));
        
        setBulkCategoryText(lines.join("\n"));
      }
    };
    reader.readAsText(file);
  };

  // Run classification API with Chunking and Concurrency to support large volumes (e.g. 1000 items)
  const runClassification = async (itemsToClassify: string[]) => {
    setIsLoading(true);
    setErrorMessage(null);
    
    const totalItems = itemsToClassify.length;
    setBatchTotal(totalItems);
    setBatchProcessed(0);
    setBatchSuccessCount(0);
    setBatchFailCount(0);
    setIsProcessingBatch(totalItems > 1);

    const CHUNK_SIZE = 25; // Safe size to guarantee output token compliance and low latency
    const CONCURRENCY_LIMIT = 3; // Max parallel requests to stay within rate limits and maintain high-throughput

    // Prepare chunks
    const chunks: string[][] = [];
    for (let i = 0; i < totalItems; i += CHUNK_SIZE) {
      chunks.push(itemsToClassify.slice(i, i + CHUNK_SIZE));
    }

    let chunkIndex = 0;

    // Helper to process a single chunk
    const processChunk = async (chunk: string[], index: number) => {
      try {
        const response = await fetch("/api/classify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            descriptions: chunk,
            categories: categories,
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || errData.details || `Error en lote ${index + 1}`);
        }

        const data = await response.json();
        if (data && Array.isArray(data.items)) {
          const timestamp = new Date().toISOString();
          const savedItems: ClassifiedItem[] = [];

          for (const item of data.items) {
            const itemWithMeta: ClassifiedItem = {
              ...item,
              createdAt: timestamp
            };

            if (user) {
              try {
                const docRef = await addDoc(collection(db, "classified_items"), {
                  userId: user.uid,
                  originalDescription: itemWithMeta.originalDescription,
                  purchasingCategory: itemWithMeta.purchasingCategory,
                  standardizedDescription: itemWithMeta.standardizedDescription,
                  brand: itemWithMeta.brand,
                  partNumber: itemWithMeta.partNumber,
                  uom: itemWithMeta.uom,
                  confidence: itemWithMeta.confidence,
                  explanation: itemWithMeta.explanation,
                  createdAt: timestamp
                });
                itemWithMeta.id = docRef.id;
              } catch (fsErr) {
                console.error("Error al guardar item en Firestore:", fsErr);
              }
            }
            savedItems.push(itemWithMeta);
          }

          // Add this chunk's results to state in real-time!
          setResults(prev => [...savedItems, ...prev]);
          setBatchSuccessCount(prev => prev + chunk.length);
          return savedItems;
        } else {
          throw new Error("El servidor devolvió un formato inesperado.");
        }
      } catch (err: any) {
        console.error(`Error procesando lote ${index + 1}:`, err);
        setBatchFailCount(prev => prev + chunk.length);
        
        // Return dummy items so we don't completely drop failing items from the UI
        const timestamp = new Date().toISOString();
        const failedItems: ClassifiedItem[] = chunk.map(desc => ({
          originalDescription: desc,
          purchasingCategory: "ERROR: NO CLASIFICADO",
          standardizedDescription: desc.toUpperCase(),
          brand: "ERROR",
          partNumber: "N/A",
          uom: "N/A",
          confidence: 0.0,
          explanation: `Error de clasificación: ${err.message || "Error desconocido"}`,
          createdAt: timestamp
        }));
        setResults(prev => [...failedItems, ...prev]);
        return failedItems;
      } finally {
        setBatchProcessed(prev => Math.min(totalItems, prev + chunk.length));
      }
    };

    // Concurrency queue runner
    const workers = Array(Math.min(CONCURRENCY_LIMIT, chunks.length))
      .fill(null)
      .map(async () => {
        while (chunkIndex < chunks.length) {
          const currentIdx = chunkIndex++;
          const currentChunk = chunks[currentIdx];
          await processChunk(currentChunk, currentIdx);
        }
      });

    try {
      await Promise.all(workers);
    } catch (err: any) {
      console.error("Error en procesamiento de trabajadores:", err);
      setErrorMessage(err.message || "Ocurrió un error inesperado al procesar los lotes.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClassifySingle = () => {
    if (!singleDescription.trim()) return;
    runClassification([singleDescription.trim()]);
  };

  const handleClassifyBulk = () => {
    if (!bulkInputText.trim()) return;
    const items = bulkInputText
      .split("\n")
      .map(item => item.trim())
      .filter(item => item.length > 0);
    
    if (items.length === 0) return;
    runClassification(items);
  };

  const handleLoadSampleBulk = () => {
    setBulkInputText(SAMPLE_ITEMS.join("\n"));
  };

  // Drag and drop events
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = (file: File) => {
    const isExcel = file.name.endsWith(".xlsx") || file.name.endsWith(".xls") || file.name.endsWith(".xlsm");
    
    if (isExcel) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const jsonData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
          
          const lines = jsonData
            .map(row => {
              if (Array.isArray(row)) {
                // Find first non-empty cell in the row
                const val = row.find(cell => cell !== undefined && cell !== null && cell !== "");
                return val !== undefined ? String(val).trim() : "";
              }
              return "";
            })
            .filter(line => line.length > 0 && !line.toLowerCase().startsWith("descripcion") && !line.toLowerCase().startsWith("description") && !line.toLowerCase().startsWith("artículo") && !line.toLowerCase().startsWith("articulo"));
            
          setBulkInputText(lines.join("\n"));
          setActiveTab("bulk");
        } catch (err) {
          console.error("Error reading material Excel file:", err);
          alert("Error al leer el archivo Excel de materiales. Verifique el formato.");
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (text) {
          // Parse simple text or simple CSV first column
          const lines = text
            .split(/\r?\n/)
            .map(line => {
              // If it's CSV, grab the first column
              if (line.includes(",")) {
                const columns = line.split(",");
                // strip quotes
                return columns[0].replace(/^"|"$/g, "").trim();
              }
              if (line.includes(";")) {
                const columns = line.split(";");
                return columns[0].replace(/^"|"$/g, "").trim();
              }
              return line.trim();
            })
            .filter(line => line.length > 0 && !line.toLowerCase().startsWith("descripcion") && !line.toLowerCase().startsWith("description") && !line.toLowerCase().startsWith("artículo") && !line.toLowerCase().startsWith("articulo"));
          
          setBulkInputText(lines.join("\n"));
          setActiveTab("bulk");
        }
      };
      reader.readAsText(file);
    }
  };

  // Result Editing handlers
  const startEditing = (index: number) => {
    setEditingIndex(index);
    setEditingItem({ ...results[index] });
  };

  const saveEditedItem = async () => {
    if (editingIndex !== null && editingItem) {
      const updated = [...results];
      const oldItem = results[editingIndex];
      updated[editingIndex] = editingItem;
      setResults(updated);

      if (user && oldItem.id) {
        try {
          const docRef = doc(db, "classified_items", oldItem.id);
          await updateDoc(docRef, {
            originalDescription: editingItem.originalDescription,
            purchasingCategory: editingItem.purchasingCategory,
            standardizedDescription: editingItem.standardizedDescription,
            brand: editingItem.brand,
            partNumber: editingItem.partNumber,
            uom: editingItem.uom,
            confidence: editingItem.confidence,
            explanation: editingItem.explanation
          });
        } catch (err) {
          console.error("Error actualizando item en Firestore:", err);
        }
      }

      setEditingIndex(null);
      setEditingItem(null);
    }
  };

  const deleteResultItem = async (index: number) => {
    const itemToDelete = results[index];
    setResults(results.filter((_, i) => i !== index));

    if (user && itemToDelete.id) {
      try {
        await deleteDoc(doc(db, "classified_items", itemToDelete.id));
      } catch (err) {
        console.error("Error eliminando item de Firestore:", err);
      }
    }
  };

  const handleClearAllHistory = async () => {
    triggerConfirm(
      "Eliminar Historial",
      "¿Está seguro de que desea eliminar permanentemente todo su historial de clasificaciones? Esta acción no se puede deshacer.",
      "clear_history"
    );
  };

  const handleAuthAction = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);

    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthError("Debe ingresar correo y contraseña.");
      setAuthLoading(false);
      return;
    }

    if (authPassword.length < 6) {
      setAuthError("La contraseña debe tener al menos 6 caracteres.");
      setAuthLoading(false);
      return;
    }

    try {
      if (authIsSignUp) {
        await createUserWithEmailAndPassword(auth, authEmail.trim(), authPassword);
      } else {
        await signInWithEmailAndPassword(auth, authEmail.trim(), authPassword);
      }
      setAuthEmail("");
      setAuthPassword("");
      setAuthError(null);
      setShowAuthModal(false);
    } catch (err: any) {
      console.error("Error de autenticación:", err);
      if (err.code === "auth/admin-restricted-operation" || err.code === "auth/operation-not-allowed") {
        setAuthError(
          <div className="flex flex-col gap-2 text-slate-700 leading-relaxed text-[11px]">
            <p className="font-semibold text-rose-700">
              El proveedor de correo electrónico o la creación de usuarios está desactivado en el proyecto Firebase.
            </p>
            <p>
              Como administrador del proyecto <code className="bg-slate-100 px-1 py-0.5 rounded text-indigo-600 font-mono text-[10px]">gen-lang-client-0531073633</code>, puede habilitarlo en unos segundos:
            </p>
            <ol className="list-decimal pl-4 flex flex-col gap-1 text-[11px] text-slate-600">
              <li>Abra la <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline font-semibold hover:text-indigo-800">Consola de Firebase</a>.</li>
              <li>Vaya a <strong className="text-slate-800">Authentication</strong> (sección Compilación).</li>
              <li>En la pestaña <strong className="text-slate-800">Sign-in method</strong>, haga clic en <strong className="text-slate-800">Agregar nuevo proveedor</strong>, elija <strong className="text-slate-800">Correo electrónico/Contraseña</strong>, actívelo y guarde.</li>
              <li>Vaya a la pestaña <strong className="text-slate-800">Settings</strong> (dentro de Authentication) &gt; menú <strong className="text-slate-800">User actions</strong> y asegúrese de que la opción <strong className="text-slate-800">Enable create (sign-up)</strong> esté activada.</li>
            </ol>
            <p className="text-[10px] text-slate-500 mt-1">
              Una vez guardado esto en su consola, podrá registrarse y conectarse sin problemas.
            </p>
          </div>
        );
      } else {
        let localizedError = "Ocurrió un error inesperado al conectar con el servicio de autenticación.";
        if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" || err.code === "auth/user-not-found") {
          localizedError = "Credenciales incorrectas. Verifique su correo y contraseña.";
        } else if (err.code === "auth/email-already-in-use") {
          localizedError = "El correo electrónico ya está registrado.";
        } else if (err.code === "auth/weak-password") {
          localizedError = "La contraseña debe tener al menos 6 caracteres.";
        } else if (err.code === "auth/invalid-email") {
          localizedError = "El formato de correo electrónico no es válido.";
        }
        setAuthError(localizedError);
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    triggerConfirm(
      "Cerrar Sesión",
      "¿Desea cerrar sesión? Su historial local se reiniciará.",
      "logout"
    );
  };

  // Export functions
  const downloadJSON = () => {
    const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
      JSON.stringify({ items: results }, null, 2)
    )}`;
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", jsonString);
    downloadAnchor.setAttribute("download", `oracle_fusion_master_data_classification_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const downloadCSV = () => {
    // Generate headers for Oracle Fusion Product Hub Item Import format
    const headers = ["OriginalDescription", "PurchasingCategory", "StandardizedDescription", "Brand", "PartNumber", "PrimaryUOM", "Confidence", "Justification"];
    const rows = results.map(item => [
      `"${item.originalDescription.replace(/"/g, '""')}"`,
      `"${item.purchasingCategory.replace(/"/g, '""')}"`,
      `"${item.standardizedDescription.replace(/"/g, '""')}"`,
      `"${item.brand.replace(/"/g, '""')}"`,
      `"${item.partNumber.replace(/"/g, '""')}"`,
      `"${item.uom.replace(/"/g, '""')}"`,
      item.confidence.toFixed(2),
      `"${item.explanation.replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const csvBlob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" }); // UTF-8 BOM
    const url = URL.createObjectURL(csvBlob);
    
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", url);
    downloadAnchor.setAttribute("download", `oracle_fusion_items_import_${Date.now()}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const downloadExcel = () => {
    // Generar archivo compatible con Microsoft Excel (HTML con UTF-8 con estilos limpios)
    const tableHeaders = [
      "Descripción Original", 
      "Categoría Oracle Fusion", 
      "Descripción Estandarizada", 
      "Marca Extraída", 
      "Número de Parte Extraído", 
      "Unidad de Medida (UOM)", 
      "Confianza", 
      "Justificación Técnica"
    ];
    
    let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">`;
    html += `<head>`;
    html += `<meta http-equiv="content-type" content="text/plain; charset=UTF-8"/>`;
    html += `<style>`;
    html += `table { border-collapse: collapse; margin: 20px auto; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }`;
    html += `th { background-color: #f59e0b; color: white; font-weight: bold; border: 1px solid #d97706; padding: 10px; font-size: 13px; text-transform: uppercase; }`;
    html += `td { border: 1px solid #e2e8f0; padding: 8px; font-size: 12px; color: #334155; }`;
    html += `tr:nth-child(even) { background-color: #f8fafc; }`;
    html += `.confidence { font-weight: bold; text-align: center; }`;
    html += `</style>`;
    html += `</head>`;
    html += `<body>`;
    html += `<h2 style="font-family: sans-serif; color: #1e293b;">Clasificación de Datos Maestros Oracle Fusion Product Hub</h2>`;
    html += `<p style="font-family: sans-serif; color: #64748b; font-size: 12px;">Fecha de reporte: ${new Date().toLocaleString()}</p>`;
    html += `<table>`;
    html += `<thead><tr>`;
    
    tableHeaders.forEach(header => {
      html += `<th>${header}</th>`;
    });
    
    html += `</tr></thead><tbody>`;
    
    results.forEach(item => {
      html += `<tr>`;
      html += `<td>${item.originalDescription.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td>`;
      html += `<td><b>${item.purchasingCategory.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</b></td>`;
      html += `<td style="font-family: monospace;">${item.standardizedDescription.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td>`;
      html += `<td>${item.brand.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td>`;
      html += `<td>${item.partNumber.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td>`;
      html += `<td style="text-align: center;">${item.uom.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td>`;
      html += `<td class="confidence" style="color: ${item.confidence > 0.8 ? '#16a34a' : '#d97706'}">${(item.confidence * 100).toFixed(0)}%</td>`;
      html += `<td>${item.explanation.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td>`;
      html += `</tr>`;
    });
    
    html += `</tbody></table></body></html>`;
    
    const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", url);
    downloadAnchor.setAttribute("download", `oracle_fusion_excel_export_${Date.now()}.xls`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const getPythonSnippet = () => {
    return `import requests
import json

# API Config para el Clasificador Experto de Oracle Fusion
API_URL = "${window.location.origin}/api/classify"

# Catálogo de Categorías de Compra Autorizadas en tu Oracle Fusion
CATEGORIES = ${JSON.stringify(categories, null, 4)}

# Lista de descripciones de artículos que requieres clasificar
items_to_classify = [
    "Balinera SKF 6204-2RSH de alta velocidad",
    "Pernos de acero inoxidable 1/4 UNF x 1 pulgada",
    "Respirador de media cara 3M serie 6200 con filtros"
]

payload = {
    "descriptions": items_to_classify,
    "categories": CATEGORIES
}

print("Enviando artículos al Clasificador Inteligente de Oracle...")
try:
    response = requests.post(API_URL, json=payload, headers={"Content-Type": "application/json"})
    response.raise_for_status()
    
    # Respuesta estructurada JSON lista para automatización
    result_data = response.json()
    
    print("\\nResultados Clasificados (Formato Oracle Fusion Product Hub):")
    print(json.dumps(result_data, indent=2, ensure_ascii=False))
    
    # Ejemplo de recorrido y procesamiento posterior
    for item in result_data["items"]:
        print(f"\\nArtículo: {item['originalDescription']}")
        print(f" ➔ Categoría Asignada: {item['purchasingCategory']}")
        print(f" ➔ Descripción Estandarizada: {item['standardizedDescription']}")
        print(f" ➔ Marca: {item['brand']} | N/Parte: {item['partNumber']}")
        print(f" ➔ Unidad (UOM): {item['uom']} | Confianza: {item['confidence']*100:.1f}%")
        
except requests.exceptions.RequestException as e:
    print(f"Error al conectar con la API de Clasificación: {e}")
`;
  };

  const getIngestPythonSnippet = () => {
    return `import requests
import json

# URL del Endpoint de Ingesta y Entrenamiento Continuo
INGEST_URL = "${window.location.origin}/api/ingest"

# Token de seguridad para autorizar la ingesta (Debe coincidir con la variable INGEST_API_KEY del servidor)
API_TOKEN = "oracle_fusion_secret_token_2026"

# Datos Maestros extraídos directamente de Oracle Fusion ERP (ej: BI Publisher o Reportes de Compras)
# Estos artículos ya han sido validados por su equipo y servirán de referencia ("entrenamiento")
payload = {
    "items": [
        {
            "originalDescription": "BOTAS DE SEGURIDAD DIELECTRICAS CON PUNTERA TALLA 42 PROCLIFFE",
            "purchasingCategory": "EPP Y SEGURIDAD INDUSTRIAL",
            "standardizedDescription": "BOTA DE SEGURIDAD DIELECTRICA T42 PROCLIFFE",
            "brand": "PROCLIFFE",
            "partNumber": "DIEL-42",
            "uom": "EACH",
            "confidence": 1.0,
            "explanation": "Validado manualmente por el equipo de compras."
        },
        {
            "originalDescription": "ACEITE LUBRICANTE MULTIGRADO SAE 15W-40 SHELL RIMULA T4 X 5 GALONES",
            "purchasingCategory": "PRODUCTOS QUIMICOS Y LUBRICANTES",
            "standardizedDescription": "ACEITE LUBRICANTE MULTIGRADO 15W-40 SHELL RIMULA 5GAL",
            "brand": "SHELL",
            "partNumber": "T4-X-5G",
            "uom": "CAJA",
            "confidence": 1.0,
            "explanation": "Cargado directamente desde el catálogo maestro aprobado."
        }
    ]
}

headers = {
    "Content-Type": "application/json",
    "x-api-key": API_TOKEN
}

print("Iniciando ingesta automática para entrenamiento de la base de datos...")
try:
    response = requests.post(INGEST_URL, json=payload, headers=headers)
    response.raise_for_status()
    
    result = response.json()
    print("\\n[Éxito] Datos de entrenamiento cargados correctamente:")
    print(f" - Artículos exitosamente ingresados: {result.get('itemsCount', 0)} / {result.get('itemsTotalAttempted', 0)}")
    
except requests.exceptions.RequestException as e:
    print(f"[Error] Falló la ingesta automática desde Oracle Fusion: {e}")
`;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPython(true);
    setTimeout(() => setCopiedPython(false), 2000);
  };

  const copyIngestToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIngestPython(true);
    setTimeout(() => setCopiedIngestPython(false), 2000);
  };

  // Filter items in UI
  const filteredResults = results.filter(item => {
    if (!filterText) return true;
    const query = filterText.toLowerCase();
    return (
      item.originalDescription.toLowerCase().includes(query) ||
      item.purchasingCategory.toLowerCase().includes(query) ||
      item.standardizedDescription.toLowerCase().includes(query) ||
      item.brand.toLowerCase().includes(query) ||
      item.partNumber.toLowerCase().includes(query)
    );
  });

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans" id="oracle-fusion-classifier-app">
      {/* Top Banner Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-xs" id="main-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-amber-500 text-white p-2.5 rounded-lg shadow-sm flex items-center justify-center">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Oracle Fusion Product Hub
                </span>
                <span className="text-xs font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                  v3.5 Intelligent Engine
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 font-display tracking-tight">
                Clasificador Experto de Datos Maestros
              </h1>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-4 text-xs">
            {/* API Status */}
            <div className="flex items-center gap-1.5 text-slate-500 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-full">
              <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Gemini Conectado</span>
            </div>

            {/* User Session Info */}
            {user ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-md font-medium">
                  <UserIcon className="w-3.5 h-3.5 text-indigo-500" />
                  <span>{user.email}</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 border border-slate-200 hover:border-rose-100 px-2.5 py-1.5 rounded-md flex items-center gap-1 transition-all cursor-pointer font-bold text-xs"
                  title="Cerrar Sesión"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Cerrar Sesión</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-slate-500 bg-slate-50 border border-slate-150 px-2.5 py-1 rounded-md font-medium" title="Su progreso se guardará de forma temporal en la sesión">
                  <Cloud className="w-3.5 h-3.5 text-slate-400" />
                  <span>Modo Local</span>
                </div>
                <button
                  onClick={() => {
                    setAuthIsSignUp(false);
                    setAuthError(null);
                    setShowAuthModal(true);
                  }}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded-md shadow-xs flex items-center gap-1 transition-all cursor-pointer hover:shadow-sm"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Iniciar Sesión / Nube</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 flex flex-col gap-8">
        
        {/* Welcome and Rule explanation block */}
        <section className="bg-radial from-slate-900 to-slate-950 text-white rounded-2xl p-6 sm:p-8 shadow-md border border-slate-800" id="intro-card">
          <div className="max-w-3xl">
            <h2 className="text-xl sm:text-2xl font-bold font-display mb-3 text-amber-400 flex items-center gap-2">
              <Sparkles className="w-6 h-6 animate-pulse" /> Automatización y Gobierno de Datos Maestros
            </h2>
            <p className="text-slate-300 leading-relaxed mb-4 text-sm sm:text-base">
              Simplifique la catalogación de sus materiales. Ingrese cualquier descripción desestructurada, sinónimos o modismos locales (p. ej. <i>"balinera", "chumacera", "bearing"</i>), y nuestro modelo entrenado los normalizará, extraerá metadatos técnicos y les asignará la <b>Categoría de Compra oficial de Oracle</b> de forma instantánea.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-400 border-t border-slate-800 pt-4 mt-2">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>Normalización Semántica</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>Extracción de Marca y N/P</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>Formatos listos para Python</span>
              </div>
            </div>
          </div>
        </section>

        {/* Core Workspace layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8" id="workspace-grid">
          
          {/* Left Column: Categories Catalog Manager (span 4) */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            
            {/* Catalog Panel */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col" id="categories-catalog">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-xl">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-amber-500" />
                  <h3 className="font-semibold text-slate-800 text-sm">
                    Categorías de Compra ({categories.length})
                  </h3>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setShowBulkCategoryUpload(!showBulkCategoryUpload)}
                    title="Carga Masiva de Categorías de Product Hub"
                    className={`p-1 rounded transition-colors flex items-center justify-center ${
                      showBulkCategoryUpload 
                        ? "bg-amber-100 text-amber-700" 
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    }`}
                  >
                    <Upload className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={handleResetCategories}
                    title="Restablecer valores por defecto"
                    className="text-slate-400 hover:text-rose-600 transition-colors p-1 hover:bg-slate-100 rounded"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Bulk Category Upload UI */}
              {showBulkCategoryUpload && (
                <div className="p-4 bg-amber-50/50 border-b border-slate-100 flex flex-col gap-3 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-900 uppercase tracking-wide">
                      Subir Catálogo de Product Hub
                    </span>
                    <button 
                      onClick={() => setShowBulkCategoryUpload(false)}
                      className="text-slate-400 hover:text-slate-600 text-xs"
                    >
                      Cancelar
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-normal">
                    Pegue una lista de categorías o cargue un archivo <b>.CSV</b>, <b>.XLS</b> o <b>.TXT</b> oficial del Product Hub de Oracle para un cumplimiento estricto de la Regla 2.
                  </p>
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={bulkCategoryText}
                      onChange={(e) => setBulkCategoryText(e.target.value)}
                      placeholder="REVESTIMIENTOS E IMPERMEABILIZANTES&#10;EQUIPAMIENTO DE OFICINA Y PAPELERIA&#10;RODAMIENTOS Y TRANSMISION DE POTENCIA"
                      rows={4}
                      className="w-full p-2 text-xs font-mono bg-white border border-slate-200 rounded-md focus:outline-hidden focus:ring-2 focus:ring-amber-500 uppercase placeholder-slate-400 text-slate-700 resize-y"
                    />
                    <div className="flex items-center justify-between text-[10px] bg-white border border-slate-200 rounded-md p-2">
                      <span className="text-slate-500 flex items-center gap-1">
                        <Upload className="w-3 h-3 text-slate-400" /> Cargar Catálogo (Excel/CSV/TXT):
                      </span>
                      <button
                        type="button"
                        onClick={() => categoryFileInputRef.current?.click()}
                        className="text-amber-600 hover:text-amber-700 font-bold cursor-pointer"
                      >
                        Examinar Archivo
                      </button>
                      <input 
                        type="file" 
                        ref={categoryFileInputRef} 
                        onChange={handleCategoryFileInput} 
                        accept=".csv,.txt,.xls,.xlsx" 
                        className="hidden" 
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleBulkCategoryImport(true)}
                      disabled={!bulkCategoryText.trim()}
                      className="flex-1 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold py-1.5 px-2 rounded-md transition-colors disabled:opacity-50 cursor-pointer text-center"
                      title="Reemplaza la lista actual completamente con este nuevo catálogo"
                    >
                      Reemplazar Catálogo
                    </button>
                    <button
                      onClick={() => handleBulkCategoryImport(false)}
                      disabled={!bulkCategoryText.trim()}
                      className="flex-1 bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-semibold py-1.5 px-2 rounded-md transition-colors disabled:opacity-50 cursor-pointer text-center"
                      title="Suma las categorías nuevas a la lista existente"
                    >
                      Fusionar / Agregar
                    </button>
                  </div>
                </div>
              )}

              {/* Form to add Category (only if not doing bulk upload to avoid clutter) */}
              {!showBulkCategoryUpload && (
                <form onSubmit={handleAddCategory} className="p-4 border-b border-slate-100 bg-slate-50/50 flex gap-2">
                  <input 
                    type="text" 
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    placeholder="NUEVA CATEGORÍA DE COMPRA..."
                    className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-hidden focus:ring-2 focus:ring-amber-500 uppercase font-mono"
                  />
                  <button 
                    type="submit"
                    disabled={!newCategory.trim()}
                    className="bg-slate-900 hover:bg-amber-500 text-white p-1.5 rounded-md transition-colors disabled:opacity-50 disabled:hover:bg-slate-900 cursor-pointer flex items-center"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </form>
              )}

              {/* Categories list */}
              <div className="p-2 max-h-[340px] overflow-y-auto divide-y divide-slate-100">
                {categories.map((cat, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2.5 hover:bg-slate-50 group rounded transition-colors">
                    <span className="text-xs font-medium text-slate-700 truncate mr-2 font-mono" title={cat}>
                      {idx + 1}. {cat}
                    </span>
                    <button 
                      onClick={() => handleRemoveCategory(idx)}
                      className="text-slate-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="p-3 bg-slate-50/50 border-t border-slate-100 text-[11px] text-slate-500">
                El clasificador restringirá su salida de categorías estrictamente a esta lista autorizada.
              </div>
            </div>

            {/* Quick Helper Tip card */}
            <div className="bg-amber-50/70 rounded-xl border border-amber-100 p-4 text-xs text-amber-900 flex gap-3">
              <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block mb-1">Criterio de Categorización:</span>
                Entradas de artículos como <code className="bg-amber-100 px-1 py-0.5 rounded">"balineras skf"</code> se traducirán automáticamente a la categoría <code className="bg-amber-100 px-1 py-0.5 rounded">"RODAMIENTOS Y TRANSMISION DE POTENCIA"</code> gracias al entendimiento semántico bilingüe de la API.
              </div>
            </div>

          </div>

          {/* Right Column: Classification Inputs and Controls (span 8) */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            
            {/* Input tabs */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden" id="classifier-inputs">
              
              {/* Tab Selector */}
              <div className="flex border-b border-slate-100 bg-slate-50">
                <button
                  onClick={() => { setActiveTab("single"); setErrorMessage(null); }}
                  className={`flex-1 py-3 px-4 text-sm font-semibold border-b-2 transition-colors flex items-center justify-center gap-2 ${
                    activeTab === "single" 
                      ? "border-amber-500 text-slate-900 bg-white" 
                      : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100/50"
                  }`}
                >
                  <Tag className="w-4 h-4" />
                  Clasificación Individual
                </button>
                <button
                  onClick={() => { setActiveTab("bulk"); setErrorMessage(null); }}
                  className={`flex-1 py-3 px-4 text-sm font-semibold border-b-2 transition-colors flex items-center justify-center gap-2 ${
                    activeTab === "bulk" 
                      ? "border-amber-500 text-slate-900 bg-white" 
                      : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100/50"
                  }`}
                >
                  <Boxes className="w-4 h-4" />
                  Procesamiento por Lotes (Bulk / CSV)
                </button>
              </div>

              {/* Tab Content */}
              <div className="p-6">
                {activeTab === "single" ? (
                  <div className="flex flex-col gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                        Descripción o Nombre Comercial del Artículo
                      </label>
                      <input 
                        type="text"
                        value={singleDescription}
                        onChange={(e) => setSingleDescription(e.target.value)}
                        placeholder="Ej. Balinera cónica Timken HM803149 o Guante de cabritilla 3M..."
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all text-sm font-medium"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleClassifySingle();
                        }}
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 mt-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-500">Pruebe ejemplos rápidos:</span>
                        <div className="flex flex-wrap gap-1.5">
                          {SAMPLE_ITEMS.slice(0, 3).map((sample, idx) => (
                            <button
                              key={idx}
                              onClick={() => setSingleDescription(sample)}
                              className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded transition-colors"
                            >
                              {sample.split(" ")[0]}...
                            </button>
                          ))}
                        </div>
                      </div>

                      <button
                        onClick={handleClassifySingle}
                        disabled={isLoading || !singleDescription.trim()}
                        className="bg-slate-900 hover:bg-amber-500 text-white text-xs font-semibold px-5 py-2.5 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:hover:bg-slate-900 cursor-pointer shadow-xs ml-auto"
                      >
                        {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                        {isLoading ? "Clasificando..." : "Clasificar Artículo"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Lista de Artículos a Clasificar (Uno por línea)
                      </label>
                      <button 
                        onClick={handleLoadSampleBulk}
                        className="text-[11px] text-amber-600 hover:text-amber-700 font-semibold flex items-center gap-1 bg-amber-50 px-2 py-0.5 rounded"
                      >
                        Cargar Lista de Ejemplos Industriales
                      </button>
                    </div>

                    {/* Drag and Drop Container */}
                    <div 
                      onDragEnter={handleDrag}
                      onDragOver={handleDrag}
                      onDragLeave={handleDrag}
                      onDrop={handleDrop}
                      className={`relative border-2 border-dashed rounded-lg p-4 transition-all flex flex-col gap-3 ${
                        dragActive 
                          ? "border-amber-500 bg-amber-50/50" 
                          : "border-slate-200 bg-slate-50/50 hover:bg-slate-50"
                      }`}
                    >
                      <textarea
                        value={bulkInputText}
                        onChange={(e) => setBulkInputText(e.target.value)}
                        placeholder="Pegue aquí su lista de materiales...&#10;Balinera SKF 6204&#10;Guante de cuero caña alta&#10;Tornillo hexagonal 1/4 x 1"
                        rows={6}
                        className="w-full bg-transparent border-0 p-0 focus:ring-0 focus:outline-hidden text-sm font-mono placeholder-slate-400 text-slate-700 resize-y"
                      />

                      {/* Drop area banner */}
                      <div className="flex items-center justify-between border-t border-slate-200/60 pt-3 text-xs text-slate-500">
                        <div className="flex items-center gap-2">
                          <Upload className="w-4 h-4 text-slate-400" />
                          <span>Arrastre un archivo <b>Excel (.xlsx/.xls)</b>, <b>.CSV</b> o <b>.TXT</b> aquí para extraerlo automáticamente</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="text-amber-600 hover:text-amber-700 font-semibold cursor-pointer"
                        >
                          Examinar Archivo
                        </button>
                        <input 
                          type="file" 
                          ref={fileInputRef} 
                          onChange={handleFileInput} 
                          accept=".csv,.txt,.xlsx,.xls,.xlsm" 
                          className="hidden" 
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 mt-1">
                      <span className="text-xs text-slate-500">
                        {bulkInputText.split("\n").filter(t => t.trim()).length} artículos detectados en cola.
                      </span>

                      <button
                        onClick={handleClassifyBulk}
                        disabled={isLoading || !bulkInputText.trim()}
                        className="bg-slate-900 hover:bg-amber-500 text-white text-xs font-semibold px-5 py-2.5 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:hover:bg-slate-900 cursor-pointer shadow-xs"
                      >
                        {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                        {isLoading ? "Clasificando Lote..." : `Clasificar Lote de Materiales`}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Server-side Gemini API key requirement notice */}
              <div className="bg-slate-50 px-6 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-slate-400" />
                  Servicio de Procesamiento por Lotes con soporte para grandes volúmenes.
                </span>
                <span className="font-medium text-slate-700">Modelo: Gemini 3.5 Flash</span>
              </div>
            </div>

            {/* Batch Processing Progress Dashboard */}
            {isProcessingBatch && (
              <div className="bg-slate-900 border border-slate-800 text-white rounded-xl p-6 shadow-xl animate-fade-in flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="bg-amber-500/10 text-amber-500 p-2 rounded-lg animate-pulse">
                      <RefreshCw className="w-5 h-5 animate-spin text-amber-400" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-100 text-sm">
                        Procesamiento de Lote en Curso (Motor Paralelo)
                      </h4>
                      <p className="text-xs text-slate-400">
                        {batchProcessed === batchTotal 
                          ? "¡Clasificación de gran volumen finalizada con éxito!" 
                          : `Clasificando de forma asíncrona: ${batchProcessed} de ${batchTotal} artículos`}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <span className="text-2xl font-black font-mono text-amber-400">
                      {batchTotal > 0 ? Math.round((batchProcessed / batchTotal) * 100) : 0}%
                    </span>
                    {batchProcessed === batchTotal && (
                      <button 
                        onClick={() => setIsProcessingBatch(false)}
                        className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-md transition-colors cursor-pointer"
                      >
                        Cerrar
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                  <div 
                    className="bg-amber-500 h-full transition-all duration-300 ease-out" 
                    style={{ width: `${batchTotal > 0 ? (batchProcessed / batchTotal) * 100 : 0}%` }}
                  />
                </div>

                {/* Dashboard Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center bg-slate-950/60 p-4 rounded-lg border border-slate-800/80">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Total Cola</span>
                    <span className="text-base font-bold font-mono text-slate-300">{batchTotal}</span>
                  </div>
                  <div className="flex flex-col gap-0.5 border-l border-slate-800">
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Procesados</span>
                    <span className="text-base font-bold font-mono text-slate-300">{batchProcessed}</span>
                  </div>
                  <div className="flex flex-col gap-0.5 border-l border-slate-800">
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Éxito AI</span>
                    <span className="text-base font-bold font-mono text-emerald-400">{batchSuccessCount}</span>
                  </div>
                  <div className="flex flex-col gap-0.5 border-l border-slate-800">
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Erróneos</span>
                    <span className="text-base font-bold font-mono text-rose-400">{batchFailCount}</span>
                  </div>
                </div>

                <div className="flex items-start gap-2 text-[11px] text-slate-400 bg-slate-950/20 p-2.5 rounded-md border border-slate-800/50">
                  <Database className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-slate-300 block mb-0.5">Tecnología de Ingesta Inteligente:</span>
                    Este motor asíncrono divide su archivo de entrada en micro-lotes de 25 registros y los envía en paralelo a través de 3 trabajadores dedicados de Gemini 3.5 Flash. Esto optimiza el consumo de tokens, elimina errores de truncamiento JSON y asegura un rendimiento estable.
                  </div>
                </div>
              </div>
            )}

            {/* Error Message if Any */}
            {errorMessage && (
              <div className="bg-rose-50 border border-rose-100 rounded-xl p-4 text-xs text-rose-800 flex gap-3 animate-fade-in">
                <AlertCircle className="w-5 h-5 text-rose-500 flex-shrink-0" />
                <div>
                  <span className="font-semibold block mb-0.5">Error de Procesamiento:</span>
                  <p>{errorMessage}</p>
                  <p className="mt-2 text-[11px] text-rose-600 font-medium">
                    Asegúrese de que su clave de API de Gemini esté cargada en la configuración de la aplicación si está ejecutando este ambiente por primera vez.
                  </p>
                </div>
              </div>
            )}

          </div>

        </div>

        {/* Results Section */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden" id="results-section">
          
          {/* Header of results panel */}
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                <Boxes className="w-5 h-5 text-amber-500" />
                Artículos Clasificados ({results.length})
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Revise, edite, y descargue los resultados en formato compatible con Oracle o scripts de automatización en Python.
              </p>
            </div>

            {/* Filter and Exports */}
            {results.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <input 
                    type="text" 
                    placeholder="Filtrar resultados..."
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-hidden focus:ring-2 focus:ring-amber-500 w-44 font-medium"
                  />
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                </div>

                <button
                  onClick={downloadJSON}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
                  title="Exportar en formato JSON estandarizado para Python"
                >
                  <FileJson className="w-3.5 h-3.5 text-amber-600" />
                  {copiedJson ? "Descargado" : "Exportar JSON"}
                </button>

                <button
                  onClick={downloadCSV}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
                  title="Descargar plantilla CSV de carga masiva para Oracle Fusion"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                  Exportar CSV Oracle
                </button>

                <button
                  onClick={downloadExcel}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
                  title="Descargar reporte formateado en Excel para control administrativo"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-amber-500" />
                  Exportar Excel
                </button>
              </div>
            )}
          </div>

          {/* Results Table list */}
          {results.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center justify-center">
              <div className="bg-slate-50 p-4 rounded-full text-slate-300 mb-3">
                <Database className="w-10 h-10" />
              </div>
              <h4 className="font-semibold text-slate-700 text-sm">No hay clasificaciones cargadas</h4>
              <p className="text-xs text-slate-400 mt-1 max-w-sm">
                Ingrese una descripción en la parte superior o cargue una lista para iniciar el clasificador basado en inteligencia artificial.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/70 border-b border-slate-100 text-slate-500 uppercase tracking-wider font-semibold">
                    <th className="py-3.5 px-4 w-1/4">Descripción de Origen</th>
                    <th className="py-3.5 px-4 w-1/4">Categoría Oracle Fusion</th>
                    <th className="py-3.5 px-4 w-1/4">Descripción Estandarizada</th>
                    <th className="py-3.5 px-4 text-center">Atributos Extraídos</th>
                    <th className="py-3.5 px-4 text-center">Confianza</th>
                    <th className="py-3.5 px-4 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredResults.map((item, idx) => {
                    const originalIdx = results.indexOf(item);
                    const isEditing = editingIndex === originalIdx;

                    return (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        
                        {/* Original Description */}
                        <td className="py-3.5 px-4 font-medium text-slate-700">
                          <span className="block font-sans max-h-16 overflow-y-auto">
                            {item.originalDescription}
                          </span>
                        </td>

                        {/* Purchasing Category */}
                        <td className="py-3.5 px-4">
                          {isEditing ? (
                            <select
                              value={editingItem?.purchasingCategory || ""}
                              onChange={(e) => setEditingItem(prev => prev ? { ...prev, purchasingCategory: e.target.value } : null)}
                              className="w-full p-1 border border-slate-300 rounded bg-white text-xs font-mono"
                            >
                              {categories.map((c, i) => (
                                <option key={i} value={c}>{c}</option>
                              ))}
                            </select>
                          ) : (
                            <div>
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-slate-700 bg-amber-50 border border-amber-200/60 font-semibold font-mono text-[11px] leading-tight max-w-full truncate">
                                <Tag className="w-3 h-3 text-amber-500 flex-shrink-0" />
                                {item.purchasingCategory}
                              </span>
                            </div>
                          )}
                        </td>

                        {/* Standardized Description */}
                        <td className="py-3.5 px-4">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editingItem?.standardizedDescription || ""}
                              onChange={(e) => setEditingItem(prev => prev ? { ...prev, standardizedDescription: e.target.value.toUpperCase() } : null)}
                              className="w-full p-1 border border-slate-300 rounded bg-white text-xs font-mono uppercase"
                            />
                          ) : (
                            <span className="font-mono text-slate-800 bg-slate-50 px-2 py-1 rounded border border-slate-100 text-[11px] block select-all">
                              {item.standardizedDescription}
                            </span>
                          )}
                        </td>

                        {/* Extracted attributes */}
                        <td className="py-3.5 px-4 text-center">
                          {isEditing ? (
                            <div className="flex flex-col gap-1">
                              <input
                                type="text"
                                placeholder="Marca"
                                value={editingItem?.brand || ""}
                                onChange={(e) => setEditingItem(prev => prev ? { ...prev, brand: e.target.value } : null)}
                                className="w-full p-1 border border-slate-300 rounded bg-white text-[10px]"
                              />
                              <input
                                type="text"
                                placeholder="N/Parte"
                                value={editingItem?.partNumber || ""}
                                onChange={(e) => setEditingItem(prev => prev ? { ...prev, partNumber: e.target.value } : null)}
                                className="w-full p-1 border border-slate-300 rounded bg-white text-[10px]"
                              />
                              <input
                                type="text"
                                placeholder="UOM"
                                value={editingItem?.uom || ""}
                                onChange={(e) => setEditingItem(prev => prev ? { ...prev, uom: e.target.value } : null)}
                                className="w-full p-1 border border-slate-300 rounded bg-white text-[10px]"
                              />
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1 items-center">
                              <div className="flex gap-1.5 text-[10px]">
                                <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                                  Marca: <b>{item.brand}</b>
                                </span>
                                <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                                  Part/No: <b>{item.partNumber}</b>
                                </span>
                              </div>
                              <span className="bg-indigo-50 text-indigo-700 font-semibold px-1.5 py-0.5 rounded text-[10px]">
                                Oracle UOM: <b>{item.uom}</b>
                              </span>
                            </div>
                          )}
                        </td>

                        {/* Confidence score */}
                        <td className="py-3.5 px-4 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`font-bold ${
                              item.confidence > 0.8 
                                ? "text-emerald-600" 
                                : item.confidence > 0.5 
                                ? "text-amber-600" 
                                : "text-rose-600"
                            }`}>
                              {(item.confidence * 100).toFixed(0)}%
                            </span>
                            <div className="w-12 bg-slate-100 rounded-full h-1">
                              <div 
                                className={`h-1 rounded-full ${
                                  item.confidence > 0.8 
                                    ? "bg-emerald-500" 
                                    : item.confidence > 0.5 
                                    ? "bg-amber-400" 
                                    : "bg-rose-400"
                                }`} 
                                style={{ width: `${item.confidence * 100}%` }}
                              ></div>
                            </div>
                          </div>
                        </td>

                        {/* Row Actions */}
                        <td className="py-3.5 px-4 text-right">
                          {isEditing ? (
                            <div className="flex justify-end gap-1.5">
                              <button 
                                onClick={saveEditedItem}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white p-1 rounded transition-colors"
                                title="Guardar Cambios"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button 
                                onClick={() => { setEditingIndex(null); setEditingItem(null); }}
                                className="bg-slate-200 hover:bg-slate-300 text-slate-600 p-1 rounded transition-colors"
                                title="Cancelar"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex justify-end gap-1.5">
                              <button 
                                onClick={() => startEditing(originalIdx)}
                                className="text-slate-400 hover:text-slate-700 p-1 hover:bg-slate-100 rounded transition-colors"
                                title="Editar Clasificación Manualmente"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button 
                                onClick={() => deleteResultItem(originalIdx)}
                                className="text-slate-400 hover:text-rose-500 p-1 hover:bg-slate-100 rounded transition-colors"
                                title="Remover de la Lista"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>

                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Results table footers */}
          {results.length > 0 && (
            <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between text-xs text-slate-500 gap-2">
              <p>
                <b>Tip:</b> La descripción estandarizada de Oracle sigue la directiva de diseño limpio sin tildes ni caracteres especiales, asegurando total compatibilidad con integraciones EDI, Python u Oracle ERP bulk utilities.
              </p>
              <button 
                onClick={handleClearAllHistory} 
                className="text-slate-400 hover:text-rose-600 font-semibold transition-colors duration-150 cursor-pointer"
              >
                Limpiar todo el historial
              </button>
            </div>
          )}
        </section>

        {/* Integration tab for python (Rule 3 output ease) */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden" id="python-integration-guide">
          <div className="p-6 border-b border-slate-100 bg-slate-50/70">
            <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <Code className="w-4 h-4 text-indigo-500" />
              Integración Directa en Python (Automatización RPA / ETL)
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Consuma esta misma API de clasificación desde sus scripts de Python para automatizar el gobierno de datos en sistemas ERP. El formato de salida JSON es totalmente compatible con la biblioteca <code className="bg-slate-100 text-slate-700 px-1 py-0.5 rounded text-[10px]">requests</code> de Python.
            </p>
          </div>
          
          <div className="p-6 bg-slate-900 text-slate-200 font-mono text-xs overflow-x-auto relative">
            <button
              onClick={() => copyToClipboard(getPythonSnippet())}
              className="absolute top-4 right-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[10px] font-bold px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors"
            >
              {copiedPython ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  Copiado!
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  Copiar Código Python
                </>
              )}
            </button>

            <pre className="text-left select-all whitespace-pre leading-relaxed font-mono">
              {getPythonSnippet()}
            </pre>
          </div>
        </section>

        {/* Ingestion integration guide for continuous training */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mt-6" id="oracle-ingestion-guide">
          <div className="p-6 border-b border-slate-100 bg-slate-50/70">
            <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-600" />
              Entrenamiento Automatizado Continuo desde Oracle Fusion ERP (API de Ingesta)
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Entrene su base de datos de manera automática. Configure un reporte programado diario (BI Publisher) en Oracle Fusion ERP que extraiga los artículos creados y aprobados manualmente por su equipo de compras. Use el siguiente script para enviarlos al endpoint <code className="bg-slate-100 text-slate-700 px-1 py-0.5 rounded text-[10px]">/api/ingest</code>, asegurando que su modelo adquiera un conocimiento operativo perfecto.
            </p>
          </div>
          
          <div className="p-6 bg-slate-900 text-slate-200 font-mono text-xs overflow-x-auto relative">
            <button
              onClick={() => copyIngestToClipboard(getIngestPythonSnippet())}
              className="absolute top-4 right-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[10px] font-bold px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors"
            >
              {copiedIngestPython ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  Copiado!
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  Copiar Código de Ingesta
                </>
              )}
            </button>

            <pre className="text-left select-all whitespace-pre leading-relaxed font-mono">
              {getIngestPythonSnippet()}
            </pre>
          </div>
        </section>

      </main>

      {/* Page Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 mt-12 text-center text-xs text-slate-400">
        <div className="max-w-7xl mx-auto px-4">
          <p>© 2026 Clasificador de Datos Maestros Oracle Fusion. Desarrollado con inteligencia artificial avanzada de Gemini.</p>
          <p className="mt-1 text-[10px] text-slate-400/80">
            Optimizada para Oracle Product Hub, ERP Procurement, Catalog Hierarchy y Gestión de Cadena de Suministro.
          </p>
        </div>
      </footer>

      {/* Auth Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-100 overflow-hidden animate-fade-in">
            <div className="p-6 border-b border-slate-100 bg-slate-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="bg-indigo-100 text-indigo-700 p-2 rounded-lg">
                    <Cloud className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm">Sincronización con la Nube</h3>
                    <p className="text-[10px] text-slate-500">Persiste tu historial y categorías en Firebase</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowAuthModal(false)}
                  className="text-slate-400 hover:text-slate-600 font-bold text-lg cursor-pointer"
                >
                  &times;
                </button>
              </div>
            </div>

            <form onSubmit={handleAuthAction} className="p-6 flex flex-col gap-4">
              {authError && (
                <div className="bg-rose-50 border border-rose-100 text-rose-700 p-3 rounded-md text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
                  <span>{authError}</span>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5 text-slate-400" /> Correo Electrónico
                </label>
                <input
                  type="email"
                  required
                  placeholder="usuario@ejemplo.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="w-full p-2.5 border border-slate-200 rounded-md text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-slate-50/50"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5 text-slate-400" /> Contraseña
                </label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="w-full p-2.5 border border-slate-200 rounded-md text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-slate-50/50"
                />
              </div>

              <button
                type="submit"
                disabled={authLoading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold py-2.5 rounded-md transition-colors shadow-xs hover:shadow-md cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 mt-2"
              >
                {authLoading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Procesando...</span>
                  </>
                ) : (
                  <>
                    <LogIn className="w-3.5 h-3.5" />
                    <span>{authIsSignUp ? "Registrarse y Crear Cuenta" : "Iniciar Sesión"}</span>
                  </>
                )}
              </button>

              <div className="text-center mt-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setAuthIsSignUp(!authIsSignUp);
                    setAuthError(null);
                  }}
                  className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
                >
                  {authIsSignUp
                    ? "¿Ya tienes cuenta? Inicia Sesión"
                    : "¿No tienes una cuenta aún? Regístrate aquí"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Custom Confirmation Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" id="custom-confirm-modal">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-100 overflow-hidden animate-fade-in">
            <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center gap-3">
              <div className="bg-amber-100 text-amber-800 p-2 rounded-lg">
                <AlertCircle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-sm">{confirmModal.title}</h3>
                <p className="text-[10px] text-slate-500">Confirmación requerida</p>
              </div>
            </div>
            <div className="p-6">
              <p className="text-slate-600 text-xs leading-relaxed">{confirmModal.message}</p>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmModal({ isOpen: false, title: "", message: "", actionType: null })}
                className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold px-4 py-2 rounded-md text-xs transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={executeConfirmedAction}
                className="bg-rose-600 hover:bg-rose-700 text-white font-semibold px-4 py-2 rounded-md text-xs transition-colors shadow-xs cursor-pointer"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
