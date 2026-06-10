import pandas as pd
from rapidfuzz import fuzz, process
import re
from fractions import Fraction

SINONIMOS = {
    r'\b(PULG|PULGADAS|PULGADA|IN|INCH|INCHES|\")\b': 'PULG',
    r'\b(MTS|METROS|METRO|MT|M)\b':                   'MT',
    r'\b(CMS|CENTIMETROS|CENTIMETRO|CM)\b':            'CM',
    r'\b(MMS|MILIMETROS|MILIMETRO|MM)\b':              'MM',
    r'\b(FTS|PIES|PIE|FT|FEET|FOOT|\')\b':            'FT',
    r'\b(KGS|KILOGRAMOS|KILOGRAMO|KG)\b':             'KG',
    r'\b(LBS|LIBRAS|LIBRA|LB)\b':                     'LB',
    r'\b(LTS|LITROS|LITRO|LT|L)\b':                   'LT',
    r'\b(GLS|GALONES|GALON|GL|GAL)\b':                'GL',
    r'\b(PSI|LB/IN2|LB/PULG2)\b':                    'PSI',
    r'\b(AMP|AMPERES|AMPERE|AMPERIO)\b':              'AMP',
    r'\b(VOLT|VOLTIOS|VOLTIO|VT|V)\b':                'VOLT',
    r'\b(ACERO INOX|ACERO INOXIDABLE|INOX|SS|INOXIDABLE)\b': 'INOX',
    r'\b(GALVANIZADO|GALV|HDG)\b':                    'GALV',
    r'\b(NPT|NPTF|TAPERED)\b':                        'NPT',
    r'\b(BSP|BSPP|BSPT)\b':                          'BSP',
    r'\b(NUM|NUMERO|NO\.|NRO)\b':                     'NUM',
    r'\b(DIAM|DIAMETRO|DIA)\b':                       'DIAM',
}

FRACCIONES_COMUNES = {
    '1-1/2':'1.5000','1-1/4':'1.2500','1-3/4':'1.7500',
    '2-1/2':'2.5000','3-1/2':'3.5000',
    '1/8':'0.1250','3/8':'0.3750','5/8':'0.6250','7/8':'0.8750',
    '1/4':'0.2500','3/4':'0.7500','1/2':'0.5000',
    '1/16':'0.0625','3/16':'0.1875','5/16':'0.3125','7/16':'0.4375',
    '9/16':'0.5625','11/16':'0.6875','13/16':'0.8125','15/16':'0.9375',
}

def aplicar_sinonimos(texto):
    for patron, reemplazo in SINONIMOS.items():
        texto = re.sub(patron, reemplazo, texto)
    return texto

def normalizar_fracciones(texto):
    texto = re.sub(r'(?<!\d)\.(\d+)', lambda m: f"0.{m.group(1).ljust(4,'0')}", texto)
    texto = re.sub(r'\b(0\.\d+)\b', lambda m: f"{float(m.group(1)):.4f}", texto)
    for fraccion, decimal in sorted(FRACCIONES_COMUNES.items(), key=lambda x: len(x[0]), reverse=True):
        texto = re.sub(rf'(?<!\d){re.escape(fraccion)}(?!\d)', decimal, texto)
    def convertir(m):
        try:
            return f"{float(Fraction(m.group(0))):.4f}"
        except:
            return m.group(0)
    texto = re.sub(r'\b\d+/\d+\b', convertir, texto)
    return texto

def extraer_numeros(texto):
    return set(re.findall(r'\d+\.\d+|\d+', texto))

def extraer_numero_parte(texto):
    patrones = [
        r'\b[A-Z]{1,4}-?\d{3,}\b',
        r'\b\d{4,}\b',
        r'\b[A-Z]\d{2,}[A-Z0-9]*\b',
        r'\b\d+[A-Z]+\d*\b',
    ]
    encontrados = []
    for p in patrones:
        encontrados.extend(re.findall(p, texto))
    return set(encontrados)

def normalizar(texto):
    texto = str(texto).upper().strip()
    texto = re.sub(r'\s+', ' ', texto)
    texto = re.sub(r'[^\w\s/\.\-]', ' ', texto)
    texto = aplicar_sinonimos(texto)
    texto = normalizar_fracciones(texto)
    texto = re.sub(r'\s+', ' ', texto).strip()
    return texto

def primera_palabra(texto):
    stopwords = {'DE','LA','EL','EN','Y','A','CON','PARA','POR','DEL','LOS','LAS'}
    for p in texto.split():
        if p not in stopwords and len(p) >= 3:
            return p
    return texto.split()[0] if texto.split() else 'OTROS'

def calcular_score_final(score_base, row_ext, row_ora):
    bonus = 0
    detalle = []
    unidad_ext = str(row_ext['UNIDAD']).upper().strip()
    unidad_ora = str(row_ora['UNIDAD']).upper().strip()
    if unidad_ext == unidad_ora:
        bonus += 3
        detalle.append("✅ Unidad igual")
    else:
        bonus -= 5
        detalle.append(f"⚠️ Unidad distinta ({unidad_ext} vs {unidad_ora})")
    nums_ext = row_ext['numeros']
    nums_ora = row_ora['numeros']
    if nums_ext and nums_ora:
        if nums_ext == nums_ora:
            bonus += 5
            detalle.append("✅ Dimensiones exactas")
        elif nums_ext & nums_ora:
            coincidencia = len(nums_ext & nums_ora) / max(len(nums_ext), len(nums_ora))
            bonus += round(coincidencia * 4)
            detalle.append(f"⚠️ Dimensiones parciales")
        else:
            bonus -= 8
            detalle.append("❌ Dimensiones distintas")
    np_ext = row_ext['nro_parte']
    np_ora = row_ora['nro_parte']
    if np_ext and np_ora:
        if np_ext & np_ora:
            bonus += 8
            detalle.append("✅ Núm. de parte coincide")
        else:
            bonus -= 10
            detalle.append("❌ Núm. de parte distinto")
    score_final = min(100, max(0, score_base + bonus))
    return score_final, " | ".join(detalle)

# ── Cargar archivos ─────────────────────────────────────────────
print("📂 Cargando archivos...")
df_oracle  = pd.read_excel("oracle_fusion.xlsx")
df_oracle  = df_oracle[['CODIGO', 'DESCRIPCION', 'UNIDAD']]

df_externo = pd.read_excel("erp_externo.xlsx", header=None)
df_externo.columns = ['CODIGO', 'DESCRIPCION', 'UNIDAD']

print(f"   Oracle:  {len(df_oracle):,} artículos")
print(f"   Externo: {len(df_externo):,} artículos")

# ── Normalizar ──────────────────────────────────────────────────
print("\n🔄 Normalizando descripciones...")
df_oracle['desc_norm']  = df_oracle['DESCRIPCION'].apply(normalizar)
df_externo['desc_norm'] = df_externo['DESCRIPCION'].apply(normalizar)
df_oracle['bloque']     = df_oracle['desc_norm'].apply(primera_palabra)
df_externo['bloque']    = df_externo['desc_norm'].apply(primera_palabra)
df_oracle['numeros']    = df_oracle['desc_norm'].apply(extraer_numeros)
df_externo['numeros']   = df_externo['desc_norm'].apply(extraer_numeros)
df_oracle['nro_parte']  = df_oracle['desc_norm'].apply(extraer_numero_parte)
df_externo['nro_parte'] = df_externo['desc_norm'].apply(extraer_numero_parte)

# ── Comparar ────────────────────────────────────────────────────
print("\n🔍 Comparando artículos...")
UMBRAL = 85
resultados = []
bloques = df_externo['bloque'].unique()

for i, bloque in enumerate(bloques):
    if i % 50 == 0:
        print(f"   Progreso: {i+1}/{len(bloques)} grupos | Pares: {len(resultados):,}")
    sub_oracle  = df_oracle[df_oracle['bloque'] == bloque].reset_index(drop=True)
    sub_externo = df_externo[df_externo['bloque'] == bloque]
    if sub_oracle.empty:
        bloques_oracle = df_oracle['bloque'].unique()
        matches_b = process.extract(bloque, bloques_oracle, scorer=fuzz.ratio, limit=2, score_cutoff=80)
        if not matches_b:
            continue
        sub_oracle = pd.concat([df_oracle[df_oracle['bloque'] == m[0]] for m in matches_b]).reset_index(drop=True)
    oracle_descs = sub_oracle['desc_norm'].tolist()
    for _, row_ext in sub_externo.iterrows():
        matches = process.extract(row_ext['desc_norm'], oracle_descs,
                                  scorer=fuzz.token_sort_ratio, limit=3, score_cutoff=UMBRAL)
        for _, score_base, idx in matches:
            row_ora = sub_oracle.iloc[idx]
            score_final, detalle = calcular_score_final(score_base, row_ext, row_ora)
            if score_final < 80:
                continue
            resultados.append({
                "CODIGO_EXTERNO":  row_ext['CODIGO'],
                "DESC_EXTERNO":    row_ext['DESCRIPCION'],
                "UNIDAD_EXTERNO":  row_ext['UNIDAD'],
                "CODIGO_ORACLE":   row_ora['CODIGO'],
                "DESC_ORACLE":     row_ora['DESCRIPCION'],
                "UNIDAD_ORACLE":   row_ora['UNIDAD'],
                "SCORE_BASE":      score_base,
                "SCORE_FINAL":     score_final,
                "DETALLE":         detalle,
                "DECISION":        "🔴 DUPLICADO"   if score_final >= 95
                                   else "⚠️ REVISAR" if score_final >= 85
                                   else "🟡 POSIBLE"
            })

df_resultado = pd.DataFrame(resultados).sort_values('SCORE_FINAL', ascending=False)

# ── Guardar resultado ───────────────────────────────────────────
print("\n💾 Guardando resultado...")
with pd.ExcelWriter("posibles_duplicados.xlsx", engine='openpyxl') as writer:
    df_resultado.to_excel(writer, index=False, sheet_name='Duplicados')
    resumen = pd.DataFrame({
        'Métrica': [
            'Total artículos Oracle',
            'Total artículos Externo',
            '🔴 Probables duplicados (≥95%)',
            '⚠️  Para revisar (85-94%)',
            '🟡 Posibles (80-84%)',
            '✅ Sin coincidencia'
        ],
        'Cantidad': [
            len(df_oracle),
            len(df_externo),
            len(df_resultado[df_resultado['SCORE_FINAL'] >= 95]),
            len(df_resultado[(df_resultado['SCORE_FINAL'] >= 85) & (df_res
