import test from "node:test";
import assert from "node:assert/strict";
import {
  consumptionAlert,
  createConsumptionAlerts,
} from "../extension/alerts/consumption-alerts.js";
import { analyzeBudget } from "../extension/analysis/budget-analyzer.js";

const settings = {
  dataAmount: 1,
  dataUnit: "MB",
  adaptiveEnabled: true,
  notificationsEnabled: true,
};
const usage = { cycle: { active: true, startsAt: 100 }, lastRenewedAt: null };
const analysis = (bytes) => analyzeBudget(settings, bytes, usage.cycle);
function fixture(initial = null) {
  let stored = initial;
  let saveFails = false;
  const calls = [];
  let permission = "granted";
  let deliveryFails = false;
  const dependencies = {
    iconUrl: "chrome-extension://test/icons/icon128.png",
    store: {
      async load() {
        return structuredClone(stored);
      },
      async save(value) {
        if (saveFails) throw new Error("disk");
        stored = structuredClone(value);
      },
    },
    notifications: {
      async clear(id) {
        calls.push({ type: "clear", id });
      },
      async getPermissionLevel() {
        return permission;
      },
      async create(id, value) {
        if (deliveryFails) throw new Error("OS refused");
        calls.push({ type: "create", id, value });
      },
    },
  };
  return {
    controller: createConsumptionAlerts(dependencies),
    dependencies,
    calls,
    stored: () => stored,
    failSave: () => {
      saveFails = true;
    },
    deny: () => {
      permission = "denied";
    },
    failDelivery: () => {
      deliveryFails = true;
    },
  };
}
test("alertas seguem metas 70/90/100, independente da ativação dos bloqueios", () => {
  for (const [bytes, expected] of [
    [699999, null],
    [700000, 70],
    [899999, 70],
    [900000, 90],
    [999999, 90],
    [1000000, 100],
    [1500000, 100],
  ])
    assert.equal(consumptionAlert(analysis(bytes))?.level ?? null, expected);
  assert.equal(
    consumptionAlert(
      analyzeBudget(
        { ...settings, adaptiveEnabled: false },
        900000,
        usage.cycle,
      ),
    ).level,
    90,
  );
  assert.equal(
    consumptionAlert(analyzeBudget(settings, 900000, { active: false })),
    null,
  );
  assert.equal(consumptionAlert(analyzeBudget(null, 900000)), null);
});
test("não repete ao publicar, reabrir ou reiniciar; salto emite somente faixa maior", async () => {
  const f = fixture();
  await f.controller.load();
  await f.controller.synchronize(analysis(950000), usage, settings);
  await f.controller.synchronize(analysis(960000), usage, settings);
  assert.equal(f.calls.filter((c) => c.type === "create").length, 1);
  assert.equal(f.stored().notifiedLevel, 90);
  const restarted = createConsumptionAlerts(f.dependencies);
  await restarted.load();
  await restarted.synchronize(analysis(970000), usage, settings);
  assert.equal(f.calls.filter((c) => c.type === "create").length, 1);
  assert.equal(
    restarted.snapshot.visible,
    true,
    "aviso permanece até confirmação",
  );
  await restarted.synchronize(analysis(1000000), usage, settings);
  assert.equal(f.calls.filter((c) => c.type === "create").length, 2);
});
test("confirmação persiste, nova faixa aparece e mensagem antiga não confirma a maior", async () => {
  const f = fixture();
  await f.controller.load();
  await f.controller.synchronize(analysis(700000), usage, settings);
  const token = f.controller.snapshot.token;
  await f.controller.acknowledge(70, token);
  assert.equal(f.controller.snapshot.visible, false);
  const restarted = createConsumptionAlerts(f.dependencies);
  await restarted.load();
  await restarted.synchronize(analysis(750000), usage, settings);
  assert.equal(restarted.snapshot.visible, false);
  await restarted.synchronize(analysis(900000), usage, settings);
  await restarted.acknowledge(70, token);
  assert.equal(restarted.snapshot.visible, true);
  await restarted.acknowledge(90, "outro-ciclo");
  assert.equal(restarted.snapshot.visible, true);
  await restarted.acknowledge(90, token);
  assert.equal(restarted.snapshot.visible, false);
});
test("renovação permite novos avisos e rejeita confirmação do ciclo anterior", async () => {
  const f = fixture();
  await f.controller.load();
  await f.controller.synchronize(analysis(1000000), usage, settings);
  const oldToken = f.controller.snapshot.token;
  await f.controller.acknowledge(100, oldToken);
  const renewed = {
    cycle: { active: true, startsAt: 200 },
    lastRenewedAt: 200,
  };
  await f.controller.synchronize(analysis(0), renewed, settings);
  assert.equal(f.stored().notifiedLevel, 0);
  assert.equal(f.controller.snapshot.visible, false);
  await f.controller.synchronize(analysis(700000), renewed, settings);
  await f.controller.acknowledge(70, oldToken);
  assert.equal(f.controller.snapshot.visible, true);
  assert.equal(f.calls.filter((c) => c.type === "create").length, 2);
});
test("editar datas/franquia não repete avisos; notificações desativadas preservam painel", async () => {
  const f = fixture();
  await f.controller.load();
  await f.controller.synchronize(analysis(700000), usage, {
    ...settings,
    notificationsEnabled: false,
  });
  assert.equal(f.calls.filter((c) => c.type === "create").length, 0);
  assert.equal(f.controller.snapshot.visible, true);
  await f.controller.synchronize(analysis(700000), usage, settings);
  await f.controller.synchronize(
    analysis(900000),
    { ...usage, cycle: { ...usage.cycle, startsAt: 50 } },
    settings,
  );
  await f.controller.synchronize(analysis(700000), usage, settings);
  await f.controller.synchronize(analysis(900000), usage, settings);
  assert.equal(f.calls.filter((c) => c.type === "create").length, 2);
});
test("falha de persistência não envia notificação e não afeta a disponibilidade do aviso", async () => {
  const f = fixture();
  await f.controller.load();
  f.failSave();
  await f.controller.synchronize(analysis(700000), usage, settings);
  assert.equal(f.calls.filter((c) => c.type === "create").length, 0);
  assert.equal(f.controller.snapshot.visible, true);
  assert.match(f.controller.snapshot.error, /salvar/);
});
test("permissão negada ou falha do SO mantém aviso sem repetir tentativas", async () => {
  for (const failure of ["deny", "failDelivery"]) {
    const f = fixture();
    await f.controller.load();
    f[failure]();
    await f.controller.synchronize(analysis(700000), usage, settings);
    assert.equal(f.controller.snapshot.visible, true);
    assert.match(f.controller.snapshot.error, /não pôde/);
    const saved = f.stored();
    await f.controller.synchronize(analysis(750000), usage, settings);
    assert.deepEqual(f.stored(), saved);
    assert.equal(f.stored().notifiedLevel, 70);
  }
});

test("monitor Normal recolhido persiste sem suprimir alertas de consumo", async () => {
  const f = fixture();
  await f.controller.load();
  await f.controller.synchronize(analysis(0), usage, settings);
  assert.equal(f.controller.snapshot.normalVisible, true);
  await f.controller.acknowledge(0, f.controller.snapshot.token);
  assert.equal(f.controller.snapshot.normalVisible, false);
  const restarted = createConsumptionAlerts(f.dependencies);
  await restarted.load();
  await restarted.synchronize(analysis(1000), usage, settings);
  assert.equal(restarted.snapshot.normalVisible, false);
  await restarted.synchronize(analysis(700000), usage, settings);
  assert.equal(restarted.snapshot.visible, true);
});
