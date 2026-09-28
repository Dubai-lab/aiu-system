"""Face quality / matching rules with synthetic face-service output (spec 20.1)."""

import numpy as np
import pytest

from app.core.config import get_settings
from app.services.face_checks import (
    FaceCheckError,
    average_embedding,
    check_frame,
    frontal_rule,
    is_duplicate,
    same_person,
    to_pgvector,
    turn_rule,
)

S = get_settings()
rng = np.random.default_rng(42)


def unit(v):
    v = np.asarray(v, dtype=float)
    return v / np.linalg.norm(v)


PERSON_A = unit(rng.normal(size=512))
PERSON_B = unit(rng.normal(size=512))


def sample(person, noise=0.25):
    """A new 'photo' of a person: the identity vector plus some noise."""
    return unit(person + noise * unit(rng.normal(size=512))).tolist()


def face(**over):
    base = {"bbox": [0, 0, 200, 240], "det_score": 0.9, "face_width_px": 200, "blur_score": 150,
            "yaw": 2.0, "pitch": -3.0, "roll": 0.0, "embedding": sample(PERSON_A)}
    return {**base, **over}


def result(*faces, error=None):
    return {"face_count": len(faces), "faces": list(faces), "error": error}


def test_good_frame_passes():
    assert check_frame(result(face()), S, frontal_rule(S))["det_score"] == 0.9


@pytest.mark.parametrize("res,code", [
    (result(), "no_face"),
    (result(face(), face()), "multiple_faces"),
    (result(face(det_score=0.3)), "low_confidence"),
    (result(face(face_width_px=80)), "too_small"),
    (result(face(blur_score=20)), "blurry"),
    (result(face(yaw=25)), "bad_pose"),
    (result(face(pitch=-30)), "bad_pose"),
    (result(error="image could not be decoded"), "bad_image"),
])
def test_bad_frames_rejected_with_reason(res, code):
    with pytest.raises(FaceCheckError) as exc:
        check_frame(res, S, frontal_rule(S))
    assert exc.value.code == code


def test_spec_messages():
    with pytest.raises(FaceCheckError, match="Move closer to the camera"):
        check_frame(result(face(face_width_px=50)), S, frontal_rule(S))
    with pytest.raises(FaceCheckError, match="Only one person"):
        check_frame(result(face(), face()), S, frontal_rule(S))


def test_slight_turn_allowed_on_turn_frames_but_not_frontal():
    turned = result(face(yaw=22))
    assert check_frame(turned, S, turn_rule(S))
    with pytest.raises(FaceCheckError):
        check_frame(turned, S, frontal_rule(S))
    with pytest.raises(FaceCheckError):  # extreme turn is still rejected
        check_frame(result(face(yaw=70)), S, turn_rule(S))


def test_average_is_unit_length_and_close_to_person():
    avg = average_embedding([sample(PERSON_A) for _ in range(5)])
    assert abs(np.linalg.norm(avg) - 1) < 1e-9
    assert avg @ PERSON_A > 0.9 and abs(avg @ PERSON_B) < 0.2


def test_same_person_detects_mixed_photos():
    assert same_person([sample(PERSON_A) for _ in range(5)], S.FACE_SAME_PERSON_MIN)
    mixed = [sample(PERSON_A) for _ in range(3)] + [sample(PERSON_B) for _ in range(2)]
    assert not same_person(mixed, S.FACE_SAME_PERSON_MIN)


def test_duplicate_ignores_own_account():
    matches = [{"user_id": "me", "similarity": 0.95}, {"user_id": "other", "similarity": 0.30}]
    assert is_duplicate(matches, "me", 0.45) is None  # re-enrolling yourself is fine
    matches.append({"user_id": "other2", "similarity": 0.62})
    assert is_duplicate(matches, "me", 0.45)["user_id"] == "other2"


def test_pgvector_format():
    text = to_pgvector(unit([1.0, 2.0, 2.0]))
    assert text.startswith("[") and text.endswith("]") and len(text.strip("[]").split(",")) == 3


# ---------------------------------------------------------------- liveness (spec 20.1: synthetic analyze outputs)
from app.services.face_checks import check_liveness, identify  # noqa: E402


def test_liveness_passes_for_a_real_turn():
    emb = sample(PERSON_A)
    left = S.FACE_YAW_LEFT_SIGN * 30
    assert check_liveness(face(embedding=emb), face(yaw=left, embedding=sample(PERSON_A)), "turn_left", S) > 0.5
    assert check_liveness(face(embedding=emb), face(yaw=-left, embedding=sample(PERSON_A)), "turn_right", S) > 0.5


@pytest.mark.parametrize("yaw_factor", [0, 0.5])  # held still, or barely moved
def test_still_photo_fails_liveness(yaw_factor):
    held_still = face(yaw=S.FACE_YAW_LEFT_SIGN * S.FACE_LIVENESS_MIN_TURN_YAW * yaw_factor)
    with pytest.raises(FaceCheckError) as exc:
        check_liveness(face(), held_still, "turn_left", S)
    assert exc.value.code == "liveness_turn"


def test_turning_the_wrong_way_fails():
    wrong_way = face(yaw=-S.FACE_YAW_LEFT_SIGN * 35)  # asked LEFT, turned RIGHT
    with pytest.raises(FaceCheckError, match="LEFT"):
        check_liveness(face(), wrong_way, "turn_left", S)


def test_two_different_photos_fail_liveness():
    other_person_turned = face(yaw=S.FACE_YAW_LEFT_SIGN * 30, embedding=sample(PERSON_B))
    with pytest.raises(FaceCheckError) as exc:
        check_liveness(face(embedding=sample(PERSON_A)), other_person_turned, "turn_left", S)
    assert exc.value.code == "liveness_mismatch"


def test_identify_accepts_clear_winner():
    r = identify([{"user_id": "a", "similarity": 0.71}, {"user_id": "b", "similarity": 0.22}], 0.45, 0.05)
    assert r.user_id == "a" and round(r.margin, 2) == 0.49


@pytest.mark.parametrize("matches", [
    [],                                                                          # nobody enrolled
    [{"user_id": "a", "similarity": 0.30}],                                      # below threshold
    [{"user_id": "a", "similarity": 0.60}, {"user_id": "b", "similarity": 0.58}],  # two look-alikes
])
def test_identify_rejects_unclear(matches):
    assert identify(matches, 0.45, 0.05).user_id is None


def test_liveness_failure_records_the_measured_angles():
    with pytest.raises(FaceCheckError) as exc:
        check_liveness(face(yaw=0), face(yaw=S.FACE_YAW_LEFT_SIGN * 9), "turn_left", S)
    assert exc.value.details["turn_yaw"] == S.FACE_YAW_LEFT_SIGN * 9 and exc.value.details["turn_step"] == "turn_left"
