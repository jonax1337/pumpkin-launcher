//! Mit Mojangs Logging-Config schreibt das Spiel log4j-XML-Events nach stdout.
//! `XmlLog` macht daraus lesbare Zeilen `[thread/LEVEL] Nachricht`; Nicht-XML-Zeilen bleiben unverändert.

#[derive(Debug, Default)]
pub struct XmlLog {
    prefix: String,
    in_cdata: bool,
}

fn attr<'a>(line: &'a str, name: &str) -> &'a str {
    let key = format!("{name}=\"");
    line.find(&key)
        .map(|i| &line[i + key.len()..])
        .and_then(|rest| rest.split('"').next())
        .unwrap_or("")
}

impl XmlLog {
    /// Nimmt eine stdout-Zeile und liefert die anzuzeigende Zeile (oder nichts für XML-Gerüst).
    pub fn line(&mut self, raw: &str) -> Option<String> {
        if self.in_cdata {
            let (text, end) = raw.split_once("]]>").map_or((raw, false), |(t, _)| (t, true));
            self.in_cdata = !end;
            return (!text.is_empty()).then(|| text.to_owned());
        }
        if let Some((_, rest)) = raw.split_once("<![CDATA[") {
            let text = match rest.split_once("]]>") {
                Some((t, _)) => t,
                None => {
                    self.in_cdata = true;
                    rest
                }
            };
            return Some(format!("{}{text}", self.prefix));
        }
        let trimmed = raw.trim_start();
        if trimmed.starts_with("<log4j:Event") {
            self.prefix = format!("[{}/{}] ", attr(trimmed, "thread"), attr(trimmed, "level"));
            return None;
        }
        if trimmed.starts_with("<log4j:") || trimmed.starts_with("</log4j:") {
            return None;
        }
        Some(raw.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::XmlLog;

    #[test]
    fn xml_events_become_plain_lines() {
        let input = [
            "plain jvm output",
            r#"<log4j:Event logger="ekp" timestamp="1" level="INFO" thread="Render thread">"#,
            "  <log4j:Message><![CDATA[Setting user: Tom]]></log4j:Message>",
            "</log4j:Event>",
            r#"<log4j:Event logger="x" timestamp="2" level="ERROR" thread="main">"#,
            "  <log4j:Message><![CDATA[boom]]></log4j:Message>",
            "  <log4j:Throwable><![CDATA[java.lang.Error",
            "\tat Foo.bar",
            "]]></log4j:Throwable>",
            "</log4j:Event>",
        ];
        let mut log = XmlLog::default();
        let out: Vec<String> = input.iter().filter_map(|l| log.line(l)).collect();
        assert_eq!(
            out,
            [
                "plain jvm output",
                "[Render thread/INFO] Setting user: Tom",
                "[main/ERROR] boom",
                "[main/ERROR] java.lang.Error",
                "\tat Foo.bar"
            ]
        );
    }
}
