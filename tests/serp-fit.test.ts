import { serpLength, SERP_LIMITS } from "../src/lib/providers";
import { CTA_POOL, fitDeterministic, splitCta, trimAtWord, worse } from "../src/lib/serp-fit";

let failures = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) {
    failures += 1;
    console.log("  FALHOU:", msg);
  } else console.log("  ok:", msg);
}

const inDesc = (text: string) =>
  serpLength(text) >= SERP_LIMITS.description.min &&
  serpLength(text) <= SERP_LIMITS.description.max;
const inTitle = (text: string) =>
  serpLength(text) >= SERP_LIMITS.title.min && serpLength(text) <= SERP_LIMITS.title.max;

console.log("1) splitCta separa corpo e CTA");
{
  const { body, cta } = splitCta(
    "Descubra tênis de corrida com amortecimento leve e solado firme para treinos longos. Veja os modelos!",
  );
  assert(cta === "Veja os modelos!", `cta reconhecido (${cta})`);
  assert(body.endsWith("longos."), "corpo termina na frase anterior");
  const semCta = splitCta("Descubra tênis de corrida para treinos longos");
  assert(semCta.cta === null, "sem CTA quando nao termina em !");
}

console.log("2) trimAtWord corta na palavra e sem pontuacao solta");
{
  const cut = trimAtWord("Tênis de corrida masculino com amortecimento, leve e confortável", 40);
  assert(serpLength(cut) <= 40, `no maximo 40 (${serpLength(cut)})`);
  assert(!cut.endsWith(",") && !cut.endsWith(" "), `sem virgula ou espaco no fim ("${cut}")`);
}

console.log("3) description curta com corpo suficiente: troca o CTA por um mais longo");
{
  const body =
    "Descubra tênis de corrida com amortecimento leve, cabedal respirável, solado firme e palmilha macia para treinos longos e provas de rua.";
  const bodyLen = serpLength(body);
  const algumCtaEncaixa = CTA_POOL.some((cta) => {
    const total = bodyLen + 1 + serpLength(cta);
    return total >= SERP_LIMITS.description.min && total <= SERP_LIMITS.description.max;
  });
  assert(algumCtaEncaixa, `precondicao: existe CTA que encaixa (corpo com ${bodyLen})`);
  const r = { newTitle: "", newDescription: `${body} Vem ver!` };
  assert(!inDesc(r.newDescription), `entrada fora da faixa (${serpLength(r.newDescription)})`);
  fitDeterministic(r);
  assert(
    inDesc(r.newDescription),
    `saida na faixa (${serpLength(r.newDescription)}): ${r.newDescription}`,
  );
  assert(r.newDescription.startsWith(body), "corpo preservado");
}

console.log("3b) description curta com corpo curto demais: fica como veio (cabe a IA reescrever)");
{
  const original =
    "Descubra tênis de corrida com amortecimento leve e solado firme para treinos longos. Vem ver!";
  const r = { newTitle: "", newDescription: original };
  fitDeterministic(r);
  assert(r.newDescription === original, "nao inventa texto para chegar a 150");
}

console.log("4) description longa: corta o corpo por palavra e fecha com CTA");
{
  const r = {
    newTitle: "",
    newDescription:
      "Descubra tênis de corrida com amortecimento leve, cabedal respirável, solado firme, palmilha anatômica, cadarço elástico e várias cores para treinos longos, provas e uso diário na cidade. Confira as opções!",
  };
  assert(serpLength(r.newDescription) > SERP_LIMITS.description.max, "entrada longa demais");
  fitDeterministic(r);
  assert(
    inDesc(r.newDescription),
    `saida na faixa (${serpLength(r.newDescription)}): ${r.newDescription}`,
  );
  assert(/!$/.test(r.newDescription), "termina com CTA");
}

console.log("5) title longo: corta por palavra dentro da faixa");
{
  const r = {
    newTitle: "Tênis de corrida masculino com amortecimento leve e solado firme",
    newDescription: "",
  };
  fitDeterministic(r);
  assert(inTitle(r.newTitle), `title na faixa (${serpLength(r.newTitle)}): ${r.newTitle}`);
}

console.log("6) title curto nao e inventado; description ja certa nao muda");
{
  const desc =
    "Descubra tênis de corrida com amortecimento leve, cabedal respirável e solado firme para treinos longos e provas de rua. Veja os modelos!";
  const r = { newTitle: "Tênis de corrida", newDescription: desc };
  const ok = inDesc(desc);
  fitDeterministic(r);
  assert(
    r.newTitle === "Tênis de corrida",
    "title curto fica como veio (a IA e que precisa reescrever)",
  );
  if (ok) assert(r.newDescription === desc, "description dentro da faixa fica intacta");
}

console.log("7) worse compara distancia ate a faixa");
{
  assert(worse("abc", "a".repeat(52), SERP_LIMITS.title), "3 chars e pior que 52");
  assert(!worse("a".repeat(55), "a".repeat(70), SERP_LIMITS.title), "55 nao e pior que 70");
}

console.log(failures === 0 ? "\nTODOS OS TESTES DE FIT PASSARAM" : `\n${failures} FALHA(S)`);
process.exit(failures === 0 ? 0 : 1);
