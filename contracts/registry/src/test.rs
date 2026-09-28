#![cfg(test)]
use super::*;
use soroban_sdk::{symbol_short, testutils::Address as _, Address, Env};

fn setup() -> (Env, RegistryContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &id);
    client.init(&admin);
    (env, client, admin)
}

#[test]
fn claim_sets_forward_and_reverse() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("alice"));
    assert_eq!(client.resolve(&symbol_short!("alice")), Some(alice.clone()));
    assert_eq!(client.reverse(&alice), Some(symbol_short!("alice")));
}

#[test]
fn unknown_handle_resolves_none() {
    let (env, client, _admin) = setup();
    assert_eq!(client.resolve(&symbol_short!("nobody")), None);
    let ghost = Address::generate(&env);
    assert_eq!(client.reverse(&ghost), None);
}

#[test]
#[should_panic]
fn claim_taken_by_other_reverts() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.claim(&alice, &symbol_short!("star"));
    client.claim(&bob, &symbol_short!("star")); // panics: HandleTaken
}

#[test]
fn reclaim_same_handle_is_idempotent() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("alice"));
    client.claim(&alice, &symbol_short!("alice")); // no-op, no panic
    assert_eq!(client.resolve(&symbol_short!("alice")), Some(alice));
}

#[test]
fn rename_frees_the_old_handle() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("old"));
    client.claim(&alice, &symbol_short!("new"));
    // old handle is freed; new one points to alice; reverse reflects the new one.
    assert_eq!(client.resolve(&symbol_short!("old")), None);
    assert_eq!(client.resolve(&symbol_short!("new")), Some(alice.clone()));
    assert_eq!(client.reverse(&alice), Some(symbol_short!("new")));
}

#[test]
fn release_frees_both_directions() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("alice"));
    client.release(&alice);
    assert_eq!(client.resolve(&symbol_short!("alice")), None);
    assert_eq!(client.reverse(&alice), None);
}

#[test]
#[should_panic]
fn release_without_handle_reverts() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    client.release(&alice); // panics: NoHandle
}

#[test]
fn freed_handle_is_reclaimable_by_another() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.claim(&alice, &symbol_short!("star"));
    client.release(&alice);
    client.claim(&bob, &symbol_short!("star"));
    assert_eq!(client.resolve(&symbol_short!("star")), Some(bob));
}

#[test]
fn admin_release_clears_a_squatted_handle() {
    let (env, client, _admin) = setup();
    let squatter = Address::generate(&env);
    let real = Address::generate(&env);
    client.claim(&squatter, &symbol_short!("brand"));
    client.admin_release(&symbol_short!("brand"));
    assert_eq!(client.resolve(&symbol_short!("brand")), None);
    assert_eq!(client.reverse(&squatter), None);
    // now the rightful owner can claim it
    client.claim(&real, &symbol_short!("brand"));
    assert_eq!(client.resolve(&symbol_short!("brand")), Some(real));
}

/// Release build of this contract, committed so the upgrade path can be tested without a
/// wasm build step in CI. Refresh with `make upgrade-fixtures` after changing the contract.
const REGISTRY_WASM: &[u8] = include_bytes!("../testdata/alvinmunk_registry.wasm");

#[test]
fn upgrade_to_identical_wasm_preserves_handles() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("alice"));

    let hash = env.deployer().upload_contract_wasm(REGISTRY_WASM);
    client.upgrade(&hash);

    assert_eq!(client.resolve(&symbol_short!("alice")), Some(alice.clone()));
    assert_eq!(client.reverse(&alice), Some(symbol_short!("alice")));
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn non_admin_upgrade_reverts() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &id);
    client.init(&admin);
    let hash = soroban_sdk::BytesN::from_array(&env, &[1; 32]);
    client.upgrade(&hash);
}

// ---------- set_meta / get_meta tests ----------

#[test]
fn set_and_get_meta_round_trip() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("alice"));

    // Pack a simple face avatar (kind=0, face index 2)
    let avatar: u64 = 2; // bit63=0 (face), bits 2:0 = 2
    let bio = soroban_sdk::String::from_str(&env, "Builder on Stellar");
    client.set_meta(&alice, &avatar, &bio);

    let meta = client.get_meta(&alice).expect("meta should be present");
    assert_eq!(meta.avatar, avatar);
    assert_eq!(meta.bio, bio);
}

#[test]
fn set_meta_overwrites_previous() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("alice"));

    let bio1 = soroban_sdk::String::from_str(&env, "first bio");
    let bio2 = soroban_sdk::String::from_str(&env, "updated bio");
    client.set_meta(&alice, &1u64, &bio1);
    client.set_meta(&alice, &2u64, &bio2);

    let meta = client.get_meta(&alice).expect("meta should be present");
    assert_eq!(meta.avatar, 2u64);
    assert_eq!(meta.bio, bio2);
}

#[test]
#[should_panic]
fn set_meta_without_handle_reverts() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    // alice has no handle yet
    let bio = soroban_sdk::String::from_str(&env, "no handle");
    client.set_meta(&alice, &0u64, &bio);
}

#[test]
#[should_panic]
fn set_meta_bio_over_80_chars_reverts() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("alice"));

    // 81-character bio
    let long = "a".repeat(81);
    let bio = soroban_sdk::String::from_str(&env, &long);
    client.set_meta(&alice, &0u64, &bio);
}

#[test]
fn set_meta_bio_exactly_80_chars_is_accepted() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("alice"));

    let exactly_80 = "a".repeat(80);
    let bio = soroban_sdk::String::from_str(&env, &exactly_80);
    client.set_meta(&alice, &0u64, &bio); // should not panic
    let meta = client.get_meta(&alice).expect("meta present");
    assert_eq!(meta.bio.len(), 80);
}

#[test]
fn get_meta_returns_none_when_unset() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("alice"));
    assert!(client.get_meta(&alice).is_none());
}

#[test]
fn kit_avatar_round_trip_via_u64() {
    // Encode a kit avatar using the same bit-packing as lib/avatar.ts encodeAvatar:
    // bit63=1 (kit), bits[2:0]=bg, [6:3]=acc, [10:7]=mouth, [14:11]=eyes, [18:15]=hair, [21:19]=skin
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("alice"));

    // skin=3 hair=7 eyes=5 mouth=4 acc=9 bg=2 → pack it
    let skin: u64 = 3 - 1; // 0-indexed
    let hair: u64 = 7 - 1;
    let eyes: u64 = 5 - 1;
    let mouth: u64 = 4 - 1;
    let acc: u64 = 9; // 0 = null, 1..=13 = acc index
    let bg: u64 = 2;  // 0 = null, 1..=5 = bg index
    let packed: u64 = (1u64 << 63) | (skin << 19) | (hair << 15) | (eyes << 11) | (mouth << 7) | (acc << 3) | bg;

    let bio = soroban_sdk::String::from_str(&env, "kit test");
    client.set_meta(&alice, &packed, &bio);

    let meta = client.get_meta(&alice).expect("meta present");
    assert_eq!(meta.avatar, packed);
    // decode and verify fields
    let v = meta.avatar;
    assert_eq!((v >> 63) & 1, 1); // kind = kit
    assert_eq!(((v >> 19) & 0b111) + 1, 3); // skin
    assert_eq!(((v >> 15) & 0b1111) + 1, 7); // hair
    assert_eq!(((v >> 11) & 0b1111) + 1, 5); // eyes
    assert_eq!(((v >> 7) & 0b1111) + 1, 4);  // mouth
    assert_eq!((v >> 3) & 0b1111, 9);         // acc
    assert_eq!(v & 0b111, 2);                 // bg
}