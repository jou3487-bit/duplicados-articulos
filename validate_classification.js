import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("ERROR: GEMINI_API_KEY no encontrada en el archivo .env");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

const descriptions = [
  "KIT DE ARRASTRE ORIGINAL PARA MOTO HONDA XR 150 - N/P: 06401-KRH-305"
];

const categories = [
  "RODAMIENTOS Y TRANSMISION DE POTENCIA",
  "PERNERIA Y ELEMENTOS DE FIJACION",
  "EPP Y SEGURIDAD INDUSTRIAL",
  "HERRAMIENTAS MANUALES Y ELECTRICAS",
  "MATERIALES ELECTRICOS Y CANALIZACIONES",
  "EQUIPAMIENTO DE OFICINA Y PAPELERIA",
  "SOPORTE Y SERVICIOS TI",
  "REPUESTOS DE MAQUINARIA PESADA",
  "REPUESTOS DE MOTOCICLETAS",
  "TUBERIAS Y ACCESORIOS DE CONEXION",
  "PRODUCTOS QUIMICOS Y LUBRICANTES",
  "SERVICIOS GENERALES Y MANTENIMIENTO"
];

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
7. REGLAS CRÍTICA DE NÚMEROS DE PARTE: Si la descripción de un artículo contiene un número de parte (combinaciones de letras y números, códigos de fábrica), NO debes aislarlo ni ignorarlo. Identifica si el artículo es un repuesto técnico (por ejemplo, repuestos de motocicletas). Los números de parte son vitales para mantener la especificidad del artículo; nunca clasifiques un repuesto técnico con número de parte bajo categorías abstractas como "genérico" o "metal". Prioriza su función real (Repuesto / Automotriz / Motocicleta).

Genera la respuesta estrictamente en formato JSON que cumpla exactamente con el esquema especificado, con un elemento por cada artículo consultado en el mismo orden.
`;

async function test() {
  console.log("Iniciando prueba de clasificación...");
  console.log("Descripción:", descriptions[0]);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
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
                  originalDescription: { type: Type.STRING },
                  purchasingCategory: { type: Type.STRING },
                  standardizedDescription: { type: Type.STRING },
                  brand: { type: Type.STRING },
                  partNumber: { type: Type.STRING },
                  uom: { type: Type.STRING },
                  confidence: { type: Type.NUMBER },
                  explanation: { type: Type.STRING }
                },
                required: [
                  "originalDescription",
                  "purchasingCategory",
                  "standardizedDescription",
                  "brand",
                  "partNumber",
                  "uom",
                  "confidence",
                  "explanation"
                ]
              }
            }
          },
          required: ["items"]
        }
      }
    });

    const text = response.text;
    console.log("\nRespuesta cruda de Gemini:\n", text);

    const parsed = JSON.parse(text.trim());
    const classified = parsed.items[0];

    console.log("\n--- RESULTADO DE LA VALIDACIÓN ---");
    console.log("Categoría asignada:", classified.purchasingCategory);
    console.log("Número de Parte extraído:", classified.partNumber);
    console.log("Marca extraída:", classified.brand);
    console.log("Descripción estandarizada:", classified.standardizedDescription);

    if (classified.purchasingCategory === "REPUESTOS DE MOTOCICLETAS" && classified.partNumber === "06401-KRH-305") {
      console.log("\n>>> ¡PRUEBA EXITOSA! La IA clasificó correctamente el artículo y mantuvo el número de parte.");
    } else {
      console.log("\n>>> ERROR: La clasificación no es la esperada.");
      process.exit(1);
    }
  } catch (err) {
    console.error("Error en la ejecución de la prueba:", err);
    process.exit(1);
  }
}

test();
