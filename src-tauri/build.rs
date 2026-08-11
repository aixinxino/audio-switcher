fn main() {
    // Keep the first prototype self-contained. Tauri's Windows resource step
    // requires an ICO even while bundling is disabled.
    let icon_path = std::path::Path::new("icons/icon.ico");
    std::fs::create_dir_all("icons").expect("create icon directory");

    let bytes_in_resource = 40 + (16 * 16 * 4) + (16 * 4);
    let mut icon = Vec::with_capacity(22 + bytes_in_resource);
    icon.extend_from_slice(&[0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0]);
    icon.extend_from_slice(&(bytes_in_resource as u32).to_le_bytes());
    icon.extend_from_slice(&22u32.to_le_bytes());
    icon.extend_from_slice(&40u32.to_le_bytes());
    icon.extend_from_slice(&16u32.to_le_bytes());
    icon.extend_from_slice(&32u32.to_le_bytes());
    icon.extend_from_slice(&1u16.to_le_bytes());
    icon.extend_from_slice(&32u16.to_le_bytes());
    icon.extend_from_slice(&0u32.to_le_bytes());
    icon.extend_from_slice(&((16 * 16 * 4) as u32).to_le_bytes());
    icon.extend_from_slice(&0u32.to_le_bytes());
    icon.extend_from_slice(&0u32.to_le_bytes());
    icon.extend_from_slice(&0u32.to_le_bytes());
    icon.extend_from_slice(&0u32.to_le_bytes());

    for y in (0..16).rev() {
        for x in 0..16 {
            let dx = x as f32 - 7.5;
            let dy = y as f32 - 7.5;
            let distance = (dx * dx + dy * dy).sqrt();
            let pixel = if distance < 6.2 {
                [42, 37, 77, 255]
            } else if distance < 7.5 {
                [183, 145, 255, 255]
            } else {
                [0, 0, 0, 0]
            };
            icon.extend_from_slice(&pixel);
        }
    }
    icon.extend(std::iter::repeat_n(0u8, 16 * 4));
    std::fs::write(icon_path, icon).expect("write placeholder icon");

    tauri_build::build()
}
