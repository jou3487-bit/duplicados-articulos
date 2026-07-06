import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, addDoc, collection } from "firebase/firestore";

dotenv.config();

const app = express();
const PORT = 3000;

// Enable JSON bodies with higher limit for large batches
app.use(express.json({ limit: "20mb" }));

// Firebase Client Configuration
const firebaseConfig = {
  apiKey: "AIzaSyC8sMFtBf0taqZ_u80eKYLxwh8o1BEUluE",
  authDomain: "gen-lang-client-0531073633.firebaseapp.com",
  projectId: "gen-lang-client-0531073633",
  storageBucket: "gen-lang-client-0531073633.firebasestorage.app",
  messagingSenderId: "315307917879",
  appId: "1:315307917879:web:57582b97919c96df6475b2"
};

const firebaseAppInstance = initializeApp(firebaseConfig);
const db = getFirestore(firebaseAppInstance, "ai-studio-ea93d4a7-6f15-4211-be1a-b9f073df6051");

// Lazy initializer for GoogleGenAI client
let aiClient: GoogleGenAI | null = null;

function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required. Please set it in the Secrets panel in AI Studio.");
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// API: Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// API: Ingest data (Categories or Reference Classified Items)
app.post("/api/ingest", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers["x-api-key"];
    const token = process.env.INGEST_API_KEY || "oracle_fusion_secret_token_2026";

    // Validate Authorization
    let isAuthorized = false;
    if (apiKeyHeader === token) {
      isAuthorized = true;
    } else if (authHeader && authHeader.startsWith("Bearer ")) {
      const extractedToken = authHeader.split(" ")[1];
      if (extractedToken === token) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(401).json({
        error: "No autorizado.",
        message: "Debe proporcionar una API Key válida en el encabezado 'x-api-key' o 'Authorization: Bearer <token>'."
      });
    }

    const { categories, items, userId } = req.body;

    if (!categories && !items) {
      return res.status(400).json({
        error: "Petición incorrecta.",
        message: "Debe proveer al menos 'categories' o 'items' para realizar la ingesta."
      });
    }

    const resultReport: any = {
      success: true,
      timestamp: new Date().toISOString()
    };

    // 1. Process Categories Ingestion
    if (categories) {
      if (!Array.isArray(categories)) {
        return res.status(400).json({ error: "El campo 'categories' debe ser un array de strings." });
      }

      const cleanCategories = categories.map((c: any) => String(c).trim().toUpperCase()).filter(Boolean);
      
      if (cleanCategories.length === 0) {
        return res.status(400).json({ error: "El array de 'categories' está vacío o contiene elementos inválidos." });
      }

      // If userId is provided, update that user's categories settings.
      // Otherwise update global settings.
      if (userId) {
        const settingsRef = doc(db, "user_settings", userId);
        await setDoc(settingsRef, {
          userId,
          categories: cleanCategories,
          updatedAt: new Date().toISOString()
        }, { merge: true });
        resultReport.categoriesUserIngested = userId;
      } else {
        const globalRef = doc(db, "global_settings", "categories");
        await setDoc(globalRef, {
          categories: cleanCategories,
          updatedAt: new Date().toISOString()
        });
        resultReport.categoriesGlobalIngested = true;
      }

      resultReport.categoriesCount = cleanCategories.length;
    }

    // 2. Process Items Ingestion
    if (items) {
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: "El campo 'items' debe ser un array de objetos." });
      }

      const itemsCollection = collection(db, "classified_items");
      let successCount = 0;
      const errors: string[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          if (!item.originalDescription || !item.purchasingCategory || !item.standardizedDescription) {
            errors.push(`Artículo en índice ${i} ignorado: Faltan campos obligatorios (originalDescription, purchasingCategory o standardizedDescription).`);
            continue;
          }

          const docPayload = {
            originalDescription: String(item.originalDescription).trim(),
            purchasingCategory: String(item.purchasingCategory).trim().toUpperCase(),
            standardizedDescription: String(item.standardizedDescription).trim().toUpperCase(),
            brand: String(item.brand || "GENERICO").trim().toUpperCase(),
            partNumber: String(item.partNumber || "N/A").trim().toUpperCase(),
            uom: String(item.uom || "EACH").trim().toUpperCase(),
            confidence: typeof item.confidence === "number" ? item.confidence : 1.0,
            explanation: String(item.explanation || "Ingestado de forma automatica desde Oracle Fusion ERP").trim(),
            userId: userId || "system_ingest",
            createdAt: item.createdAt || new Date().toISOString(),
            isIngested: true
          };

          await addDoc(itemsCollection, docPayload);
          successCount++;
        } catch (itemErr: any) {
          errors.push(`Error al insertar artículo en índice ${i}: ${itemErr.message}`);
        }
      }

      resultReport.itemsCount = successCount;
      resultReport.itemsTotalAttempted = items.length;
      if (errors.length > 0) {
        resultReport.warnings = errors;
      }
    }

    res.json(resultReport);
  } catch (err: any) {
    console.error("Error en endpoint de ingesta:", err);
    res.status(500).json({
      error: "Error interno al procesar la ingesta.",
      details: err.message || err
    });
  }
});

// API: Classify items
app.post("/api/classify", async (req, res) => {
  try {
    const { descriptions, categories } = req.body;

    if (!descriptions || !Array.isArray(descriptions) || descriptions.length === 0) {
      return res.status(400).json({ error: "Debe proporcionar un array de 'descriptions' de artículos." });
    }

    if (!categories || !Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({ error: "Debe proporcionar un catálogo de 'categories' (Categorías de Compra) válidas." });
    }

    const ai = getAIClient();

    // Prepare prompt
    const prompt = `
Eres un clasificador experto de Datos Maestros de Artículos para Oracle Fusion Product Hub. 
Tu única tarea es recibir una lista de descripciones, nombres o sinónimos de artículos de almacén y clasificarlos estrictamente en la "Categoría de Compra" oficial más adecuada según su naturaleza.

LISTA DE ARTÍCULOS A CLASIFICAR:
${descriptions.map((desc, i) => `${i + 1}. "${desc}"`).join("\n")}

CATÁLOGO DE CATEGORÍAS DE COMPRA AUTORIZADAS:
${categories.map((cat) => `- ${cat}`).join("\n")}

REGLAS DE NEGOCIO CRÍTICAS:
1. Normalización semántica: Entiende modismos locales (de Latinoamérica y España), marcas y sinónimos.
   - "balinera", "rol", "bearing", "chumacera" o rodamientos de cualquier marca (SKF, FAG, NSK) deben clasificarse en la categoría de rodamientos o elementos de transmisión de potencia de forma exacta.
   - Pernos, tuercas, arandelas, espárragos, tornillos deben ser clasificados bajo la categoría de pernería/fijación.
   - Equipamiento de seguridad como botas, guantes, cascos, lentes de protección, orejeras, mascarillas deben clasificarse bajo seguridad industrial/EPP.
2. Selección estricta: Debes buscar la categoría más cercana y coherente dentro del CATÁLOGO DE CATEGORÍAS DE COMPRA AUTORIZADAS provisto arriba. No inventes categorías nuevas fuera de esa lista. Si no encaja perfectamente, escoge la más aproximada lógicamente.
3. Estandarización de descripción: Genera un texto estandarizado en MAYÚSCULAS sin tildes ni caracteres extraños, siguiendo la sintaxis profesional de datos maestros: [NOMBRE GENERAL DEL PRODUCTO] + [ESPECIFICACIONES/MEDIDAS] + [MARCA/MODELO]. Ejemplo: "RODAMIENTO RIGIDO DE BOLAS 6204-2RSH SKF".
4. Extracción de Atributos: Identifica y extrae limpiamente la Marca (ej. "SKF", "3M", "CATERPILLAR") y el Número de Parte/Modelo si están presentes. Si no se especifican, coloca "GENERICO" para Marca y "N/A" para Número de Parte.
5. Sugiere la Unidad de Medida (UOM) estándar en Oracle Fusion más lógica (ej. "EACH", "METRO", "CAJA", "JUEGO", "LITRO", "KILOGRAMO").
6. Genera una breve explicación de 1 o 2 oraciones justificando técnicamente la clasificación en español.

Genera la respuesta estrictamente en formato JSON que cumpla exactamente con el esquema especificado, con un elemento por cada artículo consultado en el mismo orden.
`;

    // Resilient generation function with retries and fallback
    const generateWithRetryAndFallback = async () => {
      const modelsToTry = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"];
      let lastError: any = null;

      for (const modelName of modelsToTry) {
        let attempt = 0;
        const maxRetries = 3;
        let delayMs = 1000;

        while (attempt < maxRetries) {
          try {
            console.log(`[Gemini API] Intentando clasificar con el modelo ${modelName} (intento ${attempt + 1}/${maxRetries})...`);
            const response = await ai.models.generateContent({
              model: modelName,
              contents: prompt,
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    items: {
                      type: Type.ARRAY,
                      description: "Lista de artículos clasificados",
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          originalDescription: {
                            type: Type.STRING,
                            description: "La descripción original enviada para clasificar.",
                          },
                          purchasingCategory: {
                            type: Type.STRING,
                            description: "La categoría de compra asignada. DEBE ser exactamente una de las categorías provistas en el catálogo autorizado.",
                          },
                          standardizedDescription: {
                            type: Type.STRING,
                            description: "Descripción normalizada del artículo en MAYÚSCULAS según estándares de datos maestros corporativos.",
                          },
                          brand: {
                            type: Type.STRING,
                            description: "Marca del fabricante extraída (p. ej. SKF, 3M, BOSCH). Si no hay marca identificable, usar 'GENERICO'.",
                          },
                          partNumber: {
                            type: Type.STRING,
                            description: "Número de parte, código de fabricante o modelo extraído. Si no hay, usar 'N/A'.",
                          },
                          uom: {
                            type: Type.STRING,
                            description: "Código de Unidad de Medida estándar de Oracle (ej: EACH, METRO, CAJA, JUEGO, LITRO, KILOGRAMO, UNIDAD).",
                          },
                          confidence: {
                            type: Type.NUMBER,
                            description: "Nivel de confianza de la clasificación de 0.0 a 1.0.",
                          },
                          explanation: {
                            type: Type.STRING,
                            description: "Explicación breve del criterio de clasificación y sinónimos entendidos en español.",
                          },
                        },
                        required: [
                          "originalDescription",
                          "purchasingCategory",
                          "standardizedDescription",
                          "brand",
                          "partNumber",
                          "uom",
                          "confidence",
                          "explanation",
                        ],
                      },
                    },
                  },
                  required: ["items"],
                },
              },
            });
            console.log(`[Gemini API] Clasificación exitosa con el modelo: ${modelName}`);
            return response;
          } catch (error: any) {
            lastError = error;
            attempt++;
            
            // Check if error is temporary (503 Service Unavailable, 429 Rate Limit, etc.)
            const isTemporary = error.status === 503 || error.status === 429 ||
              (error.message && (
                error.message.includes("503") || 
                error.message.includes("429") || 
                error.message.includes("UNAVAILABLE") || 
                error.message.includes("high demand")
              ));

            if (isTemporary && attempt < maxRetries) {
              console.warn(`[Gemini API] Error temporal (${error.status || '503'}) con ${modelName}. Reintentando en ${delayMs}ms...`);
              await new Promise((resolve) => setTimeout(resolve, delayMs));
              delayMs *= 2;
            } else {
              console.error(`[Gemini API] Falló el intento con ${modelName}:`, error.message || error);
              break; 
            }
          }
        }
      }
      throw lastError || new Error("No se pudo clasificar los artículos debido a errores del modelo.");
    };

    const response = await generateWithRetryAndFallback();

    const text = response.text;
    if (!text) {
      throw new Error("No se recibió respuesta del clasificador inteligente.");
    }

    // Robust JSON parsing to clean any potential markdown code blocks
    let cleanText = text.trim();
    if (cleanText.startsWith("```")) {
      const matches = cleanText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
      if (matches && matches[1]) {
        cleanText = matches[1].trim();
      }
    }

    const result = JSON.parse(cleanText);
    res.json(result);
  } catch (error: any) {
    console.error("Error during item classification:", error);
    res.status(500).json({
      error: "Error interno al procesar la clasificación.",
      details: error.message || error,
    });
  }
});

// Configure development or production server
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Setup Vite as development middleware
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files from the build directory
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] running on http://localhost:${PORT}`);
  });
}

startServer();
