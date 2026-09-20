const BrowserHelper = require('../src/utils/browserHelper');
const CaptchaSolver = require('../src/utils/captchaSolver');
const fs = require('fs');
const { execSync } = require('child_process');

function transcribeAudioMp3(mp3Buffer) {
  const tmpDir = 'temp_audio';
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const timestamp = Date.now();
  const mp3Path = `${tmpDir}/recaptcha_${timestamp}.mp3`;
  const wavPath = `${tmpDir}/recaptcha_${timestamp}.wav`;
  const pyScriptPath = `${tmpDir}/stt_${timestamp}.py`;
  fs.writeFileSync(mp3Path, mp3Buffer);
  const pyCode = [
    'import soundfile as sf',
    'import speech_recognition as sr',
    'import sys',
    'try:',
    `    data, samplerate = sf.read(r"${mp3Path}")`,
    `    sf.write(r"${wavPath}", data, samplerate)`,
    '    r = sr.Recognizer()',
    `    with sr.AudioFile(r"${wavPath}") as source:`,
    '        audio = r.record(source)',
    '    text = r.recognize_google(audio)',
    '    print("RESULT:" + text)',
    '    sys.stdout.flush()',
    'except Exception as e:',
    '    print("ERROR:" + str(e))',
    '    sys.stdout.flush()'
  ].join('\n');
  fs.writeFileSync(pyScriptPath, pyCode);
  try {
    const out = execSync(`python "${pyScriptPath}"`, { timeout: 15000 }).toString().trim();
    if (out.includes('RESULT:')) return out.split('RESULT:')[1].trim();
    return null;
  } catch (err) {
    return null;
  } finally {
    try { fs.unlinkSync(mp3Path); } catch (e) {}
    try { fs.unlinkSync(wavPath); } catch (e) {}
    try { fs.unlinkSync(pyScriptPath); } catch (e) {}
  }
}

async function testSequentialSession(plate) {
  console.log(`\n======================================================`);
  console.log(`🧪 PROBANDO SECUENCIAL (MISMA PÁGINA) PARA: ${plate}`);
  console.log(`======================================================`);

  let page = null;
  try {
    const browser = await BrowserHelper.getBrowser();
    page = await browser.newPage();
    await page.goto('https://www.sat.gob.pe/VirtualSAT/principal.aspx', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const url = page.url();
    const mysession = new URL(url).searchParams.get('mysession');
    console.log(`Sesión obtenida: ${mysession}`);

    // 1. Papeletas
    const papeletasUrl = `https://www.sat.gob.pe/VirtualSAT/modulos/papeletas.aspx?mysession=${encodeURIComponent(mysession)}`;
    console.log(`1. Consultando Papeletas...`);
    await page.goto(papeletasUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1000));
    await page.select('#tipoBusquedaPapeletas', 'busqPlaca');
    await new Promise(r => setTimeout(r, 300));
    await page.type('#ctl00_cplPrincipal_txtPlaca', plate.replace('-', ''), { delay: 20 });

    let rcFrame = null;
    for (let i = 0; i < 20; i++) {
      rcFrame = page.frames().find(f => f.url().includes('recaptcha/api2/anchor'));
      if (rcFrame) {
        try {
          const anchor = await rcFrame.$('#recaptcha-anchor');
          if (anchor) {
            await rcFrame.evaluate(el => el.click(), anchor);
            await new Promise(r => setTimeout(r, 2000));
            break;
          }
        } catch (e) {}
      }
      await new Promise(r => setTimeout(r, 300));
    }

    let token = await page.evaluate(() => typeof window.grecaptcha !== 'undefined' && typeof window.grecaptcha.getResponse === 'function' ? window.grecaptcha.getResponse() : '');
    if (!token || token.length < 20) {
      let bframe = null;
      for (let i = 0; i < 20; i++) {
        bframe = page.frames().find(f => f.url().includes('recaptcha/api2/bframe'));
        if (bframe) {
          try {
            const audioBtn = await bframe.$('#recaptcha-audio-button');
            if (audioBtn) {
              await bframe.evaluate(el => el.click(), audioBtn);
              await new Promise(r => setTimeout(r, 2000));
              break;
            }
          } catch (e) {}
        }
        await new Promise(r => setTimeout(r, 300));
      }

      if (bframe) {
        for (let attempt = 1; attempt <= 3; attempt++) {
          const audioUrl = await bframe.evaluate(() => {
            const src = document.querySelector('#audio-source');
            return src ? src.src : null;
          });
          if (audioUrl) {
            const res = await fetch(audioUrl);
            const buf = Buffer.from(await res.arrayBuffer());
            const text = transcribeAudioMp3(buf);
            console.log(`Papeletas Audio STT (${attempt}):`, text);
            if (text) {
              await bframe.evaluate(() => { const el = document.querySelector('#audio-response'); if (el) el.value = ''; });
              await bframe.type('#audio-response', text, { delay: 20 });
              await bframe.evaluate(() => { const btn = document.querySelector('#recaptcha-verify-button'); if (btn) btn.click(); });
              await new Promise(r => setTimeout(r, 3000));
              let checkToken = await page.evaluate(() => typeof window.grecaptcha !== 'undefined' && typeof window.grecaptcha.getResponse === 'function' ? window.grecaptcha.getResponse() : '');
              if (checkToken.length > 20) break;
            }
          }
        }
      }
    }

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
      page.evaluate(() => {
        const btn = document.querySelector('#ctl00_cplPrincipal_CaptchaContinue');
        if (btn) btn.click();
      })
    ]);
    await new Promise(r => setTimeout(r, 1000));

    const fines = await page.evaluate(() => {
      const grid = document.querySelector('#ctl00_cplPrincipal_grdEstadoCuenta');
      if (!grid) return [];
      const trs = Array.from(grid.querySelectorAll('tr')).slice(1);
      return trs.map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim()));
    });
    console.log(`Papeletas encontradas para ${plate}: ${fines.length}`, JSON.stringify(fines));

    // 2. Impuesto Vehicular en la misma sesión
    console.log(`2. Consultando Impuesto Vehicular...`);
    const tributarioUrl = `https://www.sat.gob.pe/VirtualSAT/modulos/BusquedaTributario.aspx?mysession=${encodeURIComponent(mysession)}&tri=V`;
    await page.goto(tributarioUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 600));

    await page.evaluate((placaVal) => {
      const sel = document.getElementById('tipoBusqueda');
      if (sel) {
        sel.value = 'divBuscaPlaca';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const hidTipo = document.getElementById('ctl00_cplPrincipal_hidTipConsulta');
      if (hidTipo) hidTipo.value = 'divBuscaPlaca';
      const txtPlaca = document.getElementById('ctl00_cplPrincipal_txtPlaca');
      if (txtPlaca) txtPlaca.value = placaVal;
    }, plate.replace('-', ''));

    const captchaEl = await page.$('img[alt="Visual verification"]');
    if (captchaEl) {
      const captchaBuffer = await captchaEl.screenshot();
      const code = CaptchaSolver.solve(captchaBuffer);
      console.log(`Captcha Impuesto Vehicular: ${code}`);
      if (code) {
        await page.type('#ctl00_cplPrincipal_txtCaptcha', code, { delay: 20 });
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {}),
          page.click('#ctl00_cplPrincipal_CaptchaContinue')
        ]);
        await new Promise(r => setTimeout(r, 1000));

        const taxResult = await page.evaluate(() => {
          const body = document.body.innerText;
          const grid = document.querySelector('#ctl00_cplPrincipal_grdEstadoCuenta') || document.querySelector('table');
          return {
            noRecords: body.includes('0 coincidencias') || body.includes('No se encontraron registros'),
            tableRows: grid ? Array.from(grid.querySelectorAll('tr')).map(tr => Array.from(tr.querySelectorAll('th, td')).map(td => td.innerText.trim())) : []
          };
        });
        console.log(`Resultado Impuesto Vehicular para ${plate}:`, JSON.stringify(taxResult));
      }
    }

  } catch(e) {
    console.error('Error:', e);
  } finally {
    if (page) await BrowserHelper.closePage(page);
  }
}

async function run() {
  await testSequentialSession('B3P-128');
  await testSequentialSession('BDW-670');
  await BrowserHelper.cleanupAll();
  process.exit(0);
}

run();
