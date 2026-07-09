// ============================================================
// Zermelo Uitval Checker - Google Apps Script
// Draait elke 5 minuten, stuurt push via ntfy.sh
// ============================================================

const NTFY_TOPIC = "Zermelo"; // jouw ntfy kanaal naam

// ============================================================
// Endpoint: ontvang registratie van de app
// ============================================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const props = PropertiesService.getScriptProperties();

    if (data.action === 'register') {
      props.setProperty('ZERMELO_SCHOOL', data.school);
      props.setProperty('ZERMELO_TOKEN', data.zermelo_token);
      props.setProperty('KNOWN_CANCELLED', JSON.stringify([]));
      props.setProperty('KNOWN_STATE', JSON.stringify({}));

      setupTrigger();

      return ContentService.createTextOutput(JSON.stringify({ ok: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ error: 'unknown action' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================================
// Trigger instellen (elke 5 minuten)
// ============================================================
function setupTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    if (t.getHandlerFunction() === 'checkZermelo') {
      ScriptApp.deleteTrigger(t);
    }
  }
  ScriptApp.newTrigger('checkZermelo')
    .timeBased()
    .everyMinutes(5)
    .create();
}

// ============================================================
// Zermelo check (wordt elke 5 minuten uitgevoerd)
// ============================================================
function checkZermelo() {
  const props = PropertiesService.getScriptProperties();
  const school = props.getProperty('ZERMELO_SCHOOL');
  const zermeloToken = props.getProperty('ZERMELO_TOKEN');

  if (!school || !zermeloToken) {
    Logger.log('Geen gegevens gevonden, skip.');
    return;
  }

  let knownCancelled = JSON.parse(props.getProperty('KNOWN_CANCELLED') || '[]');
  let knownState = JSON.parse(props.getProperty('KNOWN_STATE') || '{}');
  const knownCancelledSet = new Set(knownCancelled);

  const notifications = [];

  // Check vandaag + morgen + overmorgen
  for (let i = 0; i < 3; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    date.setHours(0, 0, 0, 0);
    const startUnix = Math.floor(date.getTime() / 1000);
    const endUnix = startUnix + 86399;

    const url = `https://${school}.zportal.nl/api/v3/appointments?access_token=${zermeloToken}&user=~me&start=${startUnix}&end=${endUnix}&fields=id,start,end,subjects,teachers,locations,cancelled,changeDescription,locationChanged,teacherChanged`;

    try {
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      const json = JSON.parse(res.getContentText());
      const appointments = json.response?.data || [];

      for (const app of appointments) {
        const appId = String(app.id);
        const subject = (app.subjects || [])[0] || 'Onbekend vak';
        const startTime = app.start ? new Date(app.start * 1000) : null;
        const endTime   = app.end   ? new Date(app.end   * 1000) : null;
        const startStr  = startTime ? pad(startTime.getHours()) + ':' + pad(startTime.getMinutes()) : '';
        const endStr    = endTime   ? pad(endTime.getHours())   + ':' + pad(endTime.getMinutes())   : '';
        const timeStr   = (startStr && endStr) ? `${startStr}-${endStr}` : startStr;
        const teachers  = (app.teachers || []).join(', ');
        const locs      = (app.locations || []).sort().join(', ');
        const dayLabel  = i === 0 ? 'vandaag' : i === 1 ? 'morgen' : formatDate(date);
        const prev      = knownState[appId] || {};

        // Uitval
        if (app.cancelled) {
          if (!knownCancelledSet.has(appId)) {
            knownCancelledSet.add(appId);
            const bodyParts = [timeStr, teachers].filter(Boolean);
            notifications.push({
              title: `${subject} uitgevallen`,
              body: bodyParts.join(' ') + ' • ' + dayLabel,
            });
          }
        } else {
          knownCancelledSet.delete(appId);
        }

        // Lokaal gewijzigd
        if (app.locationChanged && prev.locations !== locs) {
          notifications.push({
            title: `${subject} lokaal gewijzigd`,
            body: `${timeStr} → ${locs || 'geen lokaal'} • ${dayLabel}`,
          });
        }

        // Docent gewijzigd
        if (app.teacherChanged && prev.teachers !== teachers) {
          notifications.push({
            title: `${subject} docent gewijzigd`,
            body: `${timeStr} → ${teachers || 'geen docent'} • ${dayLabel}`,
          });
        }

        knownState[appId] = { locations: locs, teachers };
      }

    } catch (err) {
      Logger.log(`Fout bij ophalen dag ${i}: ${err.message}`);
    }
  }

  // Sla nieuwe staat op
  props.setProperty('KNOWN_CANCELLED', JSON.stringify([...knownCancelledSet]));
  props.setProperty('KNOWN_STATE', JSON.stringify(knownState));

  // Stuur meldingen via ntfy
  for (const notif of notifications) {
    sendNtfy(notif.title, notif.body);
    Logger.log(`Melding verstuurd: ${notif.title} — ${notif.body}`);
  }
}

// ============================================================
// Ntfy push sturen
// ============================================================
function sendNtfy(title, body) {
  UrlFetchApp.fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
    method: 'post',
    headers: {
      'Title': title,
      'Priority': 'high',
      'Tags': 'school',
    },
    payload: body,
    muteHttpExceptions: true,
  });
}

// ============================================================
// Helpers
// ============================================================
function pad(n) { return String(n).padStart(2, '0'); }

function formatDate(date) {
  const days = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  const months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
}
