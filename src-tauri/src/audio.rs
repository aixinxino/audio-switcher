use serde::Serialize;
use std::{ffi::c_void, ptr};
use windows::Win32::{
    Devices::FunctionDiscovery::PKEY_Device_FriendlyName,
    Foundation::PROPERTYKEY,
    Media::Audio::Endpoints::IAudioEndpointVolume,
    Media::Audio::{
        eCapture, eCommunications, eConsole, eMultimedia, eRender, EDataFlow, ERole, IMMDevice,
        IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
    },
    System::{
        Com::StructuredStorage::{PropVariantClear, PropVariantToStringAlloc, PROPVARIANT},
        Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
            COINIT_MULTITHREADED, STGM_READ,
        },
    },
};
use windows_core::{interface, IUnknown, IUnknown_Vtbl, BOOL, HRESULT, PCWSTR, PWSTR};

const CLSID_POLICY_CONFIG_CLIENT: windows::core::GUID =
    windows::core::GUID::from_u128(0x870af99c171d4f9eaf0de63df40c2bc9);

#[interface("f8679f50-850a-41cf-9c72-430f290290c8")]
unsafe trait IPolicyConfig: IUnknown {
    fn get_mix_format(&self, device: PCWSTR, format: *mut *mut c_void) -> HRESULT;
    fn get_device_format(
        &self,
        device: PCWSTR,
        default_format: BOOL,
        format: *mut *mut c_void,
    ) -> HRESULT;
    fn reset_device_format(&self, device: PCWSTR) -> HRESULT;
    fn set_device_format(
        &self,
        device: PCWSTR,
        endpoint_format: *const c_void,
        mix_format: *const c_void,
    ) -> HRESULT;
    fn get_processing_period(
        &self,
        device: PCWSTR,
        default_period: BOOL,
        default_period_value: *mut i64,
        min_period_value: *mut i64,
    ) -> HRESULT;
    fn set_processing_period(
        &self,
        device: PCWSTR,
        default_period_value: *const i64,
        min_period_value: *const i64,
    ) -> HRESULT;
    fn get_share_mode(&self, device: PCWSTR, mode: *mut c_void) -> HRESULT;
    fn set_share_mode(&self, device: PCWSTR, mode: *const c_void) -> HRESULT;
    fn get_property_value(
        &self,
        device: PCWSTR,
        key: *const PROPERTYKEY,
        value: *mut PROPVARIANT,
    ) -> HRESULT;
    fn set_property_value(
        &self,
        device: PCWSTR,
        key: *const PROPERTYKEY,
        value: *const PROPVARIANT,
    ) -> HRESULT;
    fn set_default_endpoint(&self, device: PCWSTR, role: ERole) -> HRESULT;
    fn set_endpoint_visibility(&self, device: PCWSTR, visible: BOOL) -> HRESULT;
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub is_default: bool,
    pub muted: bool,
    pub volume: f32,
}

struct ComGuard {
    initialized: bool,
}

impl ComGuard {
    fn new() -> Self {
        let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        Self {
            initialized: result.is_ok(),
        }
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.initialized {
            unsafe { CoUninitialize() };
        }
    }
}

fn win_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

unsafe fn pwstr_to_string_and_free(value: PWSTR) -> Result<String, String> {
    let result = value.to_string().map_err(win_error);
    CoTaskMemFree(Some(value.0 as *const c_void));
    result
}

unsafe fn device_id(device: &IMMDevice) -> Result<String, String> {
    pwstr_to_string_and_free(device.GetId().map_err(win_error)?)
}

unsafe fn device_name(device: &IMMDevice, id: &str) -> String {
    let fallback = id
        .rsplit('}')
        .next()
        .map(|part| part.trim_matches(['{', '\\', '#']))
        .filter(|part| !part.is_empty())
        .unwrap_or("音频设备")
        .to_string();

    let Ok(store) = device.OpenPropertyStore(STGM_READ) else {
        return fallback;
    };
    let Ok(mut value) = store.GetValue(&PKEY_Device_FriendlyName) else {
        return fallback;
    };
    let name = PropVariantToStringAlloc(&value)
        .ok()
        .and_then(|text| {
            let name = text.to_string().ok();
            CoTaskMemFree(Some(text.0 as *const c_void));
            name
        })
        .filter(|text| !text.trim().is_empty())
        .unwrap_or(fallback);
    let _ = PropVariantClear(&mut value);
    name
}

unsafe fn endpoint_volume(device: &IMMDevice) -> Result<IAudioEndpointVolume, String> {
    device
        .Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
        .map_err(win_error)
}

unsafe fn device_is_muted(device: &IMMDevice) -> bool {
    endpoint_volume(device)
        .and_then(|volume| volume.GetMute().map_err(win_error))
        .map(|value| value.as_bool())
        .unwrap_or(false)
}

unsafe fn device_volume(device: &IMMDevice) -> f32 {
    endpoint_volume(device)
        .and_then(|volume| volume.GetMasterVolumeLevelScalar().map_err(win_error))
        .map(|value| value.clamp(0.0, 1.0))
        .unwrap_or(0.75)
}

unsafe fn enumerate_flow(
    enumerator: &IMMDeviceEnumerator,
    flow: EDataFlow,
    kind: &str,
) -> Result<Vec<AudioDevice>, String> {
    let default_id = enumerator
        .GetDefaultAudioEndpoint(flow, eConsole)
        .ok()
        .and_then(|device| device_id(&device).ok());
    let collection = enumerator
        .EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE)
        .map_err(win_error)?;
    let count = collection.GetCount().map_err(win_error)?;
    let mut devices = Vec::with_capacity(count as usize);

    for index in 0..count {
        let device = collection.Item(index).map_err(win_error)?;
        let id = device_id(&device)?;
        let is_default = default_id.as_deref() == Some(id.as_str());
        devices.push(AudioDevice {
            name: device_name(&device, &id),
            muted: device_is_muted(&device),
            volume: device_volume(&device),
            id,
            kind: kind.to_string(),
            is_default,
        });
    }
    Ok(devices)
}

unsafe fn enumerator() -> Result<IMMDeviceEnumerator, String> {
    CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(win_error)
}

#[tauri::command]
pub fn get_audio_devices() -> Result<Vec<AudioDevice>, String> {
    let _com = ComGuard::new();
    unsafe {
        let enumerator = enumerator()?;
        let mut devices = enumerate_flow(&enumerator, eRender, "output")?;
        devices.extend(enumerate_flow(&enumerator, eCapture, "input")?);
        Ok(devices)
    }
}

#[tauri::command]
pub fn set_default_device(id: String, kind: String) -> Result<(), String> {
    let _com = ComGuard::new();
    let wide_id: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
    let _ = kind;
    unsafe {
        let policy: IPolicyConfig =
            CoCreateInstance(&CLSID_POLICY_CONFIG_CLIENT, None, CLSCTX_ALL).map_err(win_error)?;
        let device = PCWSTR(wide_id.as_ptr());
        for role in [eConsole, eMultimedia, eCommunications] {
            policy
                .set_default_endpoint(device, role)
                .ok()
                .map_err(win_error)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_device_volume(id: String, volume: f32) -> Result<(), String> {
    let _com = ComGuard::new();
    let wide_id: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let device = enumerator()?
            .GetDevice(PCWSTR(wide_id.as_ptr()))
            .map_err(win_error)?;
        endpoint_volume(&device)?
            .SetMasterVolumeLevelScalar(volume.clamp(0.0, 1.0), ptr::null())
            .map_err(win_error)?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_device_mute(id: String, muted: bool) -> Result<(), String> {
    let _com = ComGuard::new();
    let wide_id: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let device = enumerator()?
            .GetDevice(PCWSTR(wide_id.as_ptr()))
            .map_err(win_error)?;
        endpoint_volume(&device)?
            .SetMute(muted, ptr::null())
            .map_err(win_error)?;
    }
    Ok(())
}

#[tauri::command]
pub fn toggle_default_input_mute() -> Result<bool, String> {
    let _com = ComGuard::new();
    unsafe {
        let device = enumerator()?
            .GetDefaultAudioEndpoint(eCapture, eConsole)
            .map_err(win_error)?;
        let volume = endpoint_volume(&device)?;
        let muted = volume.GetMute().map_err(win_error)?.as_bool();
        let next_value = !muted;
        volume.SetMute(next_value, ptr::null()).map_err(win_error)?;
        Ok(next_value)
    }
}
