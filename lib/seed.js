/* Catálogo inicial del proyecto NCH1 / Cadlan.
   Solo se usa para poblar una base vacía y para el modo local sin base. */

/* Los pendientes viven en la base compartida desde el 7/9/2026. No se guarda
   acá una copia congelada: reponerla borraría lo que el equipo cargó después. */
export const SEED_TAREAS = [];

export const SEED_CATALOGO = [
  { id: "a-myd", tipo: "area", nombre: "MYD", padre: "", orden: 100 },
  { id: "a-tyd", tipo: "area", nombre: "TYD", padre: "", orden: 200 },
  { id: "a-fsa", tipo: "area", nombre: "FSA", padre: "", orden: 300 },
  { id: "a-dch", tipo: "area", nombre: "DCH", padre: "", orden: 400 },
  { id: "a-aqm", tipo: "area", nombre: "AQM", padre: "", orden: 500 },
  { id: "a-ssnr", tipo: "area", nombre: "SSNR", padre: "", orden: 600 },
  { id: "a-gral", tipo: "area", nombre: "Gral", padre: "", orden: 700 },
  { id: "a-sa", tipo: "area", nombre: "Sin asignar", padre: "", orden: 900 },

  { id: "s-acp01", tipo: "subarea", nombre: "ACP-01", padre: "MYD", orden: 100 },
  { id: "s-acp02", tipo: "subarea", nombre: "ACP-02", padre: "MYD", orden: 200 },
  { id: "s-acp03", tipo: "subarea", nombre: "ACP-03", padre: "MYD", orden: 300 },
  { id: "s-acp04", tipo: "subarea", nombre: "ACP-04", padre: "MYD", orden: 400 },
  { id: "s-acpall", tipo: "subarea", nombre: "ACP (todas)", padre: "MYD", orden: 500 },
  { id: "s-cubmas", tipo: "subarea", nombre: "CUB-MAS", padre: "MYD", orden: 600 },
  { id: "s-chill", tipo: "subarea", nombre: "Chillers", padre: "MYD", orden: 700 },
  { id: "s-cp1", tipo: "subarea", nombre: "CP1", padre: "FSA", orden: 100 },
  { id: "s-cp3", tipo: "subarea", nombre: "CP3", padre: "AQM", orden: 100 },
  { id: "s-rack", tipo: "subarea", nombre: "Rack BMS", padre: "SSNR", orden: 100 },
  { id: "s-ssnr", tipo: "subarea", nombre: "SSNR", padre: "SSNR", orden: 200 },
  { id: "s-todas", tipo: "subarea", nombre: "Todas", padre: "Gral", orden: 100 },

  { id: "r-mm", tipo: "resp_int", nombre: "MM", padre: "", orden: 100 },
  { id: "r-gz", tipo: "resp_int", nombre: "GZ", padre: "", orden: 200 },
  { id: "r-jm", tipo: "resp_int", nombre: "JM", padre: "", orden: 300 },
  { id: "r-cadlan", tipo: "resp_int", nombre: "CadLan", padre: "", orden: 400 },

  { id: "x-amstrong", tipo: "resp_ext", nombre: "Amstrong", padre: "", orden: 100 },
  { id: "x-cadlan", tipo: "resp_ext", nombre: "Cadlan", padre: "", orden: 200 },
  { id: "x-flebbe", tipo: "resp_ext", nombre: "Cadlan – Flebbe", padre: "", orden: 300 },
  { id: "x-cadsac", tipo: "resp_ext", nombre: "Cadlan-Saceem", padre: "", orden: 400 },
  { id: "x-saceem", tipo: "resp_ext", nombre: "Saceem", padre: "", orden: 500 },
  { id: "x-google", tipo: "resp_ext", nombre: "Google", padre: "", orden: 600 },
];
