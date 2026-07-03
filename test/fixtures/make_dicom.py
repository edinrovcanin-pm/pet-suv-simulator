"""Generate synthetic PET DICOM files with KNOWN SUV values to test the parser."""
import numpy as np
from pydicom.dataset import Dataset, FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid
import math, os

OUT = os.path.dirname(os.path.abspath(__file__))

# --- Known ground-truth parameters ---
WEIGHT_KG = 70.0
DOSE_BQ = 370e6            # 370 MBq
HALFLIFE_S = 6586.2        # F-18
INJ_TIME = "120000"        # 12:00:00
ACQ_TIME = "130000"        # 13:00:00  -> 3600 s = 60 min uptake
SLOPE = 2.0
INTERCEPT = 0.0
ROWS = COLS = 8

decay_time = 3600.0
decayed_dose = DOSE_BQ * 2 ** (-decay_time / HALFLIFE_S)
suv_scale = (WEIGHT_KG * 1000.0) / decayed_dose   # SUV per (Bq/mL)

def suv_to_stored(suv):
    conc = suv / suv_scale                 # Bq/mL
    stored = (conc - INTERCEPT) / SLOPE     # invert rescale
    return int(round(stored))

# Ground-truth SUV map: background 1.0, hot lesion 8.0 at center
suv_map = np.full((ROWS, COLS), 1.0, dtype=float)
suv_map[3:5, 3:5] = 8.0
suv_map[0, 0] = 0.0  # a zero voxel

stored = np.vectorize(suv_to_stored)(suv_map).astype(np.uint16)

def make(fname, instance, slice_loc, acq_time):
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.128"  # PET Image Storage
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    meta.ImplementationClassUID = generate_uid()

    ds = FileDataset(fname, {}, file_meta=meta, preamble=b"\0" * 128)
    ds.PatientName = "Test^Pacijent"
    ds.PatientID = "TEST-42"
    ds.PatientWeight = WEIGHT_KG
    ds.Modality = "PT"
    ds.SeriesDescription = "TEST PET"
    ds.ManufacturerModelName = "SynthScanner"
    ds.Units = "BQML"
    ds.DecayCorrection = "START"
    ds.SeriesTime = acq_time
    ds.AcquisitionTime = acq_time
    ds.InstanceNumber = instance
    ds.SliceLocation = slice_loc

    rad = Dataset()
    rad.RadionuclideTotalDose = DOSE_BQ
    rad.RadionuclideHalfLife = HALFLIFE_S
    rad.RadiopharmaceuticalStartTime = INJ_TIME
    ds.RadiopharmaceuticalInformationSequence = [rad]

    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.Rows = ROWS
    ds.Columns = COLS
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 0
    ds.RescaleSlope = SLOPE
    ds.RescaleIntercept = INTERCEPT
    ds.PixelData = stored.tobytes()

    ds.save_as(os.path.join(OUT, fname), write_like_original=False)

make("test_slice1.dcm", 1, 0.0, ACQ_TIME)
make("test_slice2.dcm", 2, 5.0, ACQ_TIME)

# Emit expected values for the JS test to compare against.
import json
print(json.dumps({
    "weightKg": WEIGHT_KG,
    "doseBq": DOSE_BQ,
    "halfLifeSec": HALFLIFE_S,
    "uptakeMinutes": 60.0,
    "decayedDoseBq": decayed_dose,
    "suvScale": suv_scale,
    "expectedSuvMax": 8.0,
    "expectedBackgroundSuv": 1.0,
    "storedLesion": int(stored[3, 3]),
    "storedBackground": int(stored[1, 1]),
    "rows": ROWS, "cols": COLS,
}, indent=2))
