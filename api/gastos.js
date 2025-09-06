// api/gastos.js
import { google } from "googleapis";

export async function consultarGastosPorCategoria({ userNumber, categoria, periodo }) {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  const sheets = google.sheets({ version: "v4", auth });

  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: "messages!A:I" // A = timestamp, B = userNumber, C = userText, D = aiText...
  });

  const linhas = data.values || [];
  const agora = new Date();
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();

  let total = 0;

  for (const linha of linhas) {
    const [timestamp, numero, entradaUsuario] = linha;
    if (!timestamp || !numero || !entradaUsuario) continue;

    // Verifica se o número bate
    if (numero !== userNumber) continue;

    // Confere se a mensagem tem estrutura de gasto
    const match = entradaUsuario.match(/(gastei|gasto)\\s+R?\\$?\\s?(\\d+[\\d,.]*)\\s+em\\s+(.*)/i);
    if (!match) continue;

    const valor = parseFloat(match[2].replace(".", "").replace(",", "."));
    const categoriaInformada = match[3]?.trim().toLowerCase();

    if (!categoriaInformada.includes(categoria.toLowerCase())) continue;

    // Verifica se o registro é do mês atual
    const dataLinha = new Date(timestamp);
    if (dataLinha.getMonth() !== mesAtual || dataLinha.getFullYear() !== anoAtual) continue;

    total += valor;
  }

  return total;
}
