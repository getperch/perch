use std::{env, fs, path::Path};

use typify::{TypeSpace, TypeSpaceSettings};

/// Generates Rust request/response structs from `services/api/openapi.json` (committed, regenerated
/// via `pnpm --filter @perch/api generate-openapi` whenever a route's contract changes — see
/// infra/README.md). `@hono/zod-openapi` inlines every route's schema directly at its usage site
/// (there's no `.openapi("Name")` call anywhere in services/api, so `components.schemas` is empty —
/// confirmed by inspecting the generated doc) rather than emitting shared named components, so this
/// walks `paths` directly and generates one named type per request body / response body schema,
/// instead of the more typical "extract components.schemas" approach.
fn main() {
    // Must run unconditionally, on every platform — this is what generates mobile's
    // `tauri.settings.gradle`/`tauri.build.gradle.kts` (via TAURI_ANDROID_PROJECT_PATH), the app
    // icon/context codegen, and other tauri-build responsibilities the typify codegen below has
    // nothing to do with. Dropping this call compiles fine on desktop (nothing surfaces the
    // missing mobile codegen until an actual `tauri android build`, which fails at the Gradle step
    // with "tauri.settings.gradle does not exist") but breaks Android entirely.
    tauri_build::build();

    println!("cargo:rerun-if-changed=../../../services/api/openapi.json");

    let openapi_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../services/api/openapi.json");
    let openapi_raw = fs::read_to_string(&openapi_path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", openapi_path.display()));
    let openapi: serde_json::Value = serde_json::from_str(&openapi_raw).unwrap();

    let mut type_space = TypeSpace::new(TypeSpaceSettings::default().with_struct_builder(true));

    let paths = openapi["paths"].as_object().expect("openapi.paths must be an object");
    for (path, methods) in paths {
        let methods = methods.as_object().unwrap();
        for (method, op) in methods {
            let name_base = operation_name(path, method);

            if let Some(schema) = op.pointer("/requestBody/content/application~1json/schema") {
                add_named_type(&mut type_space, schema, &format!("{name_base}Request"));
            }

            let responses = op["responses"].as_object().cloned().unwrap_or_default();
            if let Some(response) = responses.get("200") {
                if let Some(content) = response["content"].as_object() {
                    // Only one content type per response in this API (application/json, or
                    // text/event-stream for the SSE route) — take whichever is present.
                    if let Some((_, media)) = content.iter().next() {
                        if let Some(schema) = media.get("schema") {
                            add_named_type(&mut type_space, schema, &format!("{name_base}Response"));
                        }
                    }
                }
            }
        }
    }

    let contents = prettyplease::unparse(&syn::parse2::<syn::File>(type_space.to_stream()).unwrap());

    let mut out_file = Path::new(&env::var("OUT_DIR").unwrap()).to_path_buf();
    out_file.push("api_types.rs");
    fs::write(out_file, contents).unwrap();
}

fn add_named_type(type_space: &mut TypeSpace, schema_json: &serde_json::Value, name_hint: &str) {
    let schema: schemars::schema::Schema =
        serde_json::from_value(schema_json.clone()).unwrap_or_else(|e| panic!("invalid schema for {name_hint}: {e}"));
    type_space
        .add_type_with_name(&schema, Some(name_hint.to_string()))
        .unwrap_or_else(|e| panic!("failed to add type {name_hint}: {e}"));
}

/// `/channels/{channelId}/messages` + `post` -> `PostChannelsChannelIdMessages`
fn operation_name(path: &str, method: &str) -> String {
    let mut name = pascal_case(method);
    for segment in path.split('/').filter(|s| !s.is_empty()) {
        let segment = segment.trim_start_matches('{').trim_end_matches('}');
        name.push_str(&pascal_case(segment));
    }
    name
}

fn pascal_case(s: &str) -> String {
    s.split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect()
}
