# Fuentes oficiales — ejercicio 2026

Las casillas y reglas de Autonomous se basan en documentación pública de la AEAT.
Si hay incertidumbre, la aplicación muestra `⚠️ Revisar fiscalmente` y no inventa.

## Modelo 130

- Instrucciones AEAT Modelo 130 (pago fraccionado IRPF estimación directa):
  https://sede.agenciatributaria.gob.es/Sede/impuestos-tasas/impuesto-sobre-renta-personas-fisicas/modelo-130-irpf______esionales-estimacion-directa-fraccionado_/instrucciones.html
- Procedimiento G601:
  https://sede.agenciatributaria.gob.es/Sede/procedimientos/G601.shtml
- Orden EHA/672/2007 (modelo 130/131)

Casillas Apartado I (actividades no agrarias) usadas en MVP:
- 01 Ingresos íntegros computables acumulados YTD
- 02 Gastos deducibles acumulados YTD
- 03 Rendimiento neto (01−02)
- 04 20% de 03 si positivo
- 05 Pagos fraccionados anteriores del ejercicio
- 06 Retenciones e ingresos a cuenta acumulados
- 07 Resultado (04−05−06)

## Modelo 303

- Instrucciones 2026 (02–12 y 2T–4T):
  https://sede.agenciatributaria.gob.es/Sede/todas-gestiones/impuestos-tasas/iva/modelo-303-iva-autoliquidacion_/instrucciones-2026/instrucciones-02-12-2t-4t-2026.html
- IVA devengado (solo operaciones **sujetas y no exentas**): 0% → 150–152; 4% → 01–03; 10% → 04–06; 21% → 07–09
- Operaciones `exempt` / `not_subject`: **no** entran en 150–09 (la 150 no es “exentas”, es tipo 0% sujeto)
- IVA deducible:
  - 28/29 — operaciones interiores corrientes (base / cuota)
  - 30/31 — bienes de inversión (`expenseNature === 'fixed_asset'`)
  - 45 = 29 + 31; 46 = 27 − 45
- Resultado (territorio común, sin regularizaciones ni complementarias):
  - 64 = 46 (suma de resultados 46 + 58 + 76); 65 = 100 %; 66 = 64 × 65
  - 110 = cuotas a compensar pendientes de periodos previos (la AEAT la prerrellena);
    Autonomous la toma del último 303 presentado anterior (incluido el 4T del año previo)
  - 78 = min(110, max(0, 66)): solo se compensa si el periodo sale a ingresar
  - 87 = 110 − 78
  - 69 = 66 − 78; 71 = 69
  - Pendiente para el siguiente periodo (casilla interna `carry`) = 87 + |71| si 71 < 0
  - 4T con 71 negativo: se puede pedir devolución; Autonomous asume compensar
- Información adicional:
  - 120 — operaciones no sujetas por reglas de localización (ingresos `not_subject`; se marcan para revisar)
- Ingresos al 0 % sin `vatTreatment: 'zero_rate'` explícito: aviso en la 150 (pueden ser exentos o no sujetos)
- Cada casilla indica `page` (liquidacion / resultado / adicional) y `entry`
  (manual = la teclea el usuario, auto = la calcula la Sede, prefilled = la trae la AEAT)

## Amortizaciones

- Tablas de coeficientes según normativa IRPF / inmovilizado. El coeficiente lo introduce el usuario; Autonomous aplica método lineal sobre la base.

## Notas MVP

- Solo estimación directa simplificada + IVA régimen general + criterio de devengo.
- Operaciones ISP, AIB, importaciones: no soportadas en MVP (warning).
- Gastos de difícil justificación: ajuste manual con flag uncertain.
